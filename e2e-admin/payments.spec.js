// Admin e2e for PAID BOOKING (Shopify), written TEST-FIRST against
// AI/plans/paid-booking-and-signin-link-contract.md (sections 2, 3 and 5.1). The feature code did
// not exist when this was written, so these specs are RED until it lands.
//
// What is covered: the 15-minute hold, the signed `orders/paid` webhook (rejections, ignored
// cases, confirmation, duplicates), the calendar event written after payment, late payments (slot
// still free / slot lost) and a payment for a booking the admin cancelled.
//
// It runs against the REAL server with an IN-MEMORY MongoDB (support/startServer.js) and FAKE
// Shopify settings (store https://shop.e2e.test, variant 12345, a test webhook secret). The fake
// webhook is signed exactly like Shopify does: base64(HMAC-SHA256(secret, rawBody)). Nothing here
// touches a real database, Shopify, Postmark or Google Calendar.
//
// Serial, shared DB. Every test uses its OWN user (a user may hold one booking at a time), and
// slots are always taken from the API list ("the first free slot"), never a hard-coded date.
import { test, expect } from '@playwright/test';
import { signIn } from './support/session.js';
import {
  createUser, bearer, buildOrder, postWebhook, payBooking, forceHoldStale, withDb,
} from './support/shopify.js';

test.describe.configure({ mode: 'serial' });

// Data shared between the serial specs (one hold is reused by tests 1-5).
const s = { u1: null, hold: null, slot: null, order: null, flagged: null };

const row = (page, id) => page.locator(`tr[data-booking-id="${id}"]`);

// The first free slot the API offers to `user`.
async function firstSlot(request, user) {
  const res = await request.get('/api/bookings/slots', { headers: bearer(user) });
  expect(res.status()).toBe(200);
  const { slots } = await res.json();
  expect(slots.length).toBeGreaterThan(0);
  return slots[0];
}

// Books `startsAt` as `user` and returns the booking from the 201 response.
async function hold(request, user, startsAt) {
  const res = await request.post('/api/bookings', { headers: bearer(user), data: { startsAt } });
  expect(res.status()).toBe(201);
  const { booking } = await res.json();
  expect(booking.status).toBe('pending_payment');
  return booking;
}

// The user's own upcoming booking (what the app shows).
async function mineUpcoming(request, user) {
  const res = await request.get('/api/bookings/mine', { headers: bearer(user) });
  expect(res.status()).toBe(200);
  return (await res.json()).upcoming;
}

test.describe('payments', () => {
  // 1. The hold
  test('1. booking creates a 15-minute hold with a Shopify checkout link and shows Awaiting payment', async ({ request, page, context }) => {
    s.u1 = await createUser('e2e-pay-1@example.test', 'Pia');
    s.slot = await firstSlot(request, s.u1);
    s.hold = await hold(request, s.u1, s.slot.startsAt);

    // holdExpiresAt is about 15 minutes ahead (allow 14-16 min).
    const minutes = (new Date(s.hold.holdExpiresAt) - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThan(16);

    // checkoutUrl: cart permalink of the consultation variant, carrying the booking id and email.
    expect(s.hold.checkoutUrl.startsWith('https://shop.e2e.test/cart/12345:1?')).toBe(true);
    const url = new URL(s.hold.checkoutUrl);
    expect(url.searchParams.get('attributes[getpretty_booking]')).toBe(s.hold.id);
    expect(url.searchParams.get('checkout[email]')).toBe(s.u1.email);

    // The admin Upcoming tab lists the live hold as "Awaiting payment".
    await signIn(context);
    await page.goto('/admin/bookings');
    await expect(row(page, s.hold.id).locator('td.status')).toContainText('Awaiting payment');
  });

  // 2. Signature checks
  test('2. a bad or missing signature is 401 invalid_signature and the booking is unchanged', async ({ request }) => {
    s.order = buildOrder({ bookingId: s.hold.id, email: s.u1.email });
    const bad = await postWebhook(request, s.order, { signature: 'bad' });
    expect(bad.status()).toBe(401);
    expect((await bad.json()).code).toBe('invalid_signature');
    const none = await postWebhook(request, s.order, { signature: 'none' });
    expect(none.status()).toBe(401);
    expect((await mineUpcoming(request, s.u1)).status).toBe('pending_payment');
  });

  // 3. Signed but not a payment we act on
  test('3. wrong topic, no attribute, other product and unknown booking are 200 and ignored', async ({ request }) => {
    const cases = [
      [buildOrder({ bookingId: s.hold.id, email: s.u1.email }), { topic: 'orders/create' }, 'ignored_topic'],
      [buildOrder({ bookingId: s.hold.id, email: s.u1.email, noAttribute: true }), {}, 'no_booking_attribute'],
      [buildOrder({ bookingId: s.hold.id, email: s.u1.email, variantId: 99999 }), {}, 'wrong_product'],
      // A well-formed ObjectId that matches no booking.
      [buildOrder({ bookingId: '64b7f0f0f0f0f0f0f0f0f0f0', email: s.u1.email }), {}, 'booking_not_found'],
    ];
    for (const [order, opts, expected] of cases) {
      const res = await postWebhook(request, order, opts);
      expect(res.status(), expected).toBe(200);
      expect((await res.json()).result).toBe(expected);
    }
    // None of them confirmed anything.
    expect((await mineUpcoming(request, s.u1)).status).toBe('pending_payment');
  });

  // 4. The real payment
  test('4. a correct webhook confirms the booking, shows Paid, and the calendar event follows', async ({ request, page, context }) => {
    const res = await postWebhook(request, s.order);
    expect(res.status()).toBe(200);
    expect((await res.json()).result).toBe('confirmed');

    const upcoming = await mineUpcoming(request, s.u1);
    expect(upcoming.id).toBe(s.hold.id);
    expect(upcoming.status).toBe('confirmed');

    await signIn(context);
    await page.goto('/admin/bookings');
    const r = row(page, s.hold.id);
    await expect(r.locator('td.status')).toContainText('Confirmed');
    await expect(r.locator('td.payment')).toContainText('Paid');
    await expect(r.locator('td.payment')).toContainText(String(s.order.id));

    // The calendar event is written right AFTER the response (and retried by a 60 s sweep).
    await expect.poll(() => withDb(async ({ Booking }) => {
      const b = await Booking.findById(s.hold.id).lean();
      return b && b.calendarEventId ? 'synced' : 'pending';
    }), { timeout: 10_000 }).toBe('synced');
    await page.reload();
    await expect(row(page, s.hold.id).locator('td.status')).not.toContainText('Calendar pending');
  });

  // 5. Shopify may deliver the same webhook twice
  test('5. a duplicate delivery of the same order is 200 already_recorded and changes nothing', async ({ request }) => {
    const res = await postWebhook(request, s.order);
    expect(res.status()).toBe(200);
    expect((await res.json()).result).toBe('already_recorded');
    const upcoming = await mineUpcoming(request, s.u1);
    expect(upcoming.id).toBe(s.hold.id);
    expect(upcoming.status).toBe('confirmed');
  });

  // 6. Customer pays after the 15 minutes, nobody else took the slot
  test('6. a late payment with the slot still free confirms the booking', async ({ request }) => {
    const u = await createUser('e2e-pay-late-free@example.test', 'Lia');
    const slot = await firstSlot(request, u);
    const b = await hold(request, u, slot.startsAt);
    await forceHoldStale(b.id);
    const { res } = await payBooking(request, b, u);
    expect(res.status()).toBe(200);
    expect((await res.json()).result).toBe('confirmed');
    expect((await mineUpcoming(request, u)).status).toBe('confirmed');
  });

  // 7. Customer pays after the 15 minutes AND somebody else got the slot
  test('7. a late payment when the slot was taken is needs_attention (Paid, slot lost)', async ({ request, page, context }) => {
    const userB = await createUser('e2e-pay-lost-b@example.test', 'Bea');
    const userC = await createUser('e2e-pay-lost-c@example.test', 'Cal');
    const slot = await firstSlot(request, userB);
    const bBooking = await hold(request, userB, slot.startsAt);
    await forceHoldStale(bBooking.id);

    // C books the same slot (B's stale hold no longer blocks it) and pays: confirmed.
    const cBooking = await hold(request, userC, slot.startsAt);
    const cPaid = await payBooking(request, cBooking, userC);
    expect((await cPaid.res.json()).result).toBe('confirmed');

    // B's payment arrives too late: money received, but the slot is gone.
    const bPaid = await payBooking(request, bBooking, userB);
    expect(bPaid.res.status()).toBe(200);
    expect((await bPaid.res.json()).result).toBe('needs_attention');

    await signIn(context);
    await page.goto('/admin/bookings?tab=attention');
    const r = row(page, bBooking.id);
    await expect(r).toHaveCount(1);
    await expect(r.locator('td.attention')).toContainText('Paid, slot lost');
  });

  // 8. Admin cancels a hold, then the customer pays anyway
  test('8. admin cancels an awaiting-payment booking; a later payment is needs_attention (Paid after cancel)', async ({ request, page, context }) => {
    const u = await createUser('e2e-pay-cancel@example.test', 'Dan');
    const slot = await firstSlot(request, u);
    const b = await hold(request, u, slot.startsAt);

    await signIn(context);
    // The cancel form asks "are you sure" through a confirm dialog; accept it.
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/admin/bookings');
    await expect(row(page, b.id).locator('td.status')).toContainText('Awaiting payment');
    await row(page, b.id).getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page).toHaveURL(/\/admin\/bookings/);
    await expect(row(page, b.id)).toHaveCount(0);

    // It now lives in the Cancelled tab.
    await page.getByRole('link', { name: 'Cancelled', exact: true }).click();
    await expect(row(page, b.id)).toHaveCount(1);

    // The customer still paid in Shopify: the money must be flagged for the admin.
    const { res } = await payBooking(request, b, u);
    expect(res.status()).toBe(200);
    expect((await res.json()).result).toBe('needs_attention');
    await page.goto('/admin/bookings?tab=attention');
    await expect(row(page, b.id).locator('td.attention')).toContainText('Paid after cancel');
    s.flagged = b; // test 9 marks this flagged row as handled
  });

  test('9. Mark handled removes the row from Needs attention and the audit log records it', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/bookings?tab=attention');
    await expect(row(page, s.flagged.id).locator('td.attention')).toContainText('Paid after cancel');
    await row(page, s.flagged.id).getByRole('button', { name: 'Mark handled' }).click();
    await expect(page).toHaveURL(/tab=attention/);
    await expect(page.locator('.notice')).toContainText('Marked as handled.');
    // Handled rows leave the tab (the booking itself is untouched).
    await expect(row(page, s.flagged.id)).toHaveCount(0);

    await page.goto('/admin/audit');
    await expect(page.locator('body')).toContainText('booking attention handled');
  });
});
