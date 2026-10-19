// Admin bookings e2e specs, written TEST-FIRST against AI/plans/in-app-booking-contract.md
// (section 7 Admin, section 6 routes, section 10 "Playwright admin"). The booking code did not
// exist when this was written, so these specs are RED until the build lands.
//
// They run against the REAL server with an IN-MEMORY MongoDB (see support/startServer.js, which
// turns booking on with the FAKE calendar: busy 12:00-13:00 clinic time every day). Nothing
// here touches a real database or the real Google calendar.
//
// INTENDED CHANGE (paid booking, 2026-10-12): booking is no longer instant. POST /api/bookings
// now creates a 15-minute HOLD (status 'pending_payment', with holdExpiresAt and a Shopify
// checkoutUrl). The booking only becomes 'confirmed' when a correctly signed fake Shopify
// `orders/paid` webhook arrives (see support/shopify.js). Rules asserted here: a user with a
// live hold gets the hold REPLACED by a new booking (201); a user with a CONFIRMED upcoming
// booking gets 409 limit_reached; held or confirmed slots answer slot_taken. Expectations that
// used to say "201 confirmed" were changed on purpose. Source: AI/plans/paid-booking-and-signin-link-contract.md
//
// Specs share one DB and run serially in file order; later specs use data made by earlier ones.
// Slots depend on the real "now", so we never hard-code a date: we pick a slot from the API.
import { test, expect } from '@playwright/test';
import { signIn } from './support/session.js';
import { createUser, bearer, payBooking, withDb } from './support/shopify.js';

test.describe.configure({ mode: 'serial' });

// Data shared between the serial specs.
const state = {
  userA: null,      // { id, email, token }
  userB: null,
  slot: null,       // the slot userA books: { startsAt, endsAt, date, time }
  bookingId: null,
};

const notice = page => page.locator('.notice');

// Books `startsAt` through the real API as `user`.
const book = (request, user, startsAt) =>
  request.post('/api/bookings', { headers: bearer(user), data: { startsAt } });

// The row of the booking in the list (id comes from the POST response).
const row = (page, id) => page.locator(`tr[data-booking-id="${id}"]`);

test.describe('bookings', () => {
  // 1. Signed out
  test('1. signed-out booking pages redirect to login', async ({ page }) => {
    for (const url of ['/admin/bookings', '/admin/booking-settings']) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/admin\/login/);
    }
  });

  // 2. Nav
  test('2. nav has a Bookings link that opens the list', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin');
    const link = page.getByRole('link', { name: 'Bookings', exact: true });
    await expect(link).toHaveAttribute('href', '/admin/bookings');
    await link.click();
    await expect(page).toHaveURL(/\/admin\/bookings$/);
    await expect(page.getByRole('heading', { name: 'Bookings', exact: true })).toBeVisible();
    // Nothing booked yet.
    await expect(page.locator('p.muted', { hasText: 'No bookings.' })).toBeVisible();
  });

  // 3. API: unauthenticated config
  test('3. /api/bookings/config without a token is 401', async ({ request }) => {
    const res = await request.get('/api/bookings/config');
    expect(res.status()).toBe(401);
    expect((await res.json()).code).toBe('auth_required');
  });

  // 4. Setup users + book through the real API
  test('4. API: hold 201 pending_payment, hold replaced, webhook confirms, then 409 limit_reached / slot_taken', async ({ request }) => {
    state.userA = await createUser('e2e-booker-a@example.test', 'Alma');
    state.userB = await createUser('e2e-booker-b@example.test', 'Ben');

    // Public config for a signed-in user.
    const cfg = await request.get('/api/bookings/config', { headers: bearer(state.userA) });
    expect(cfg.status()).toBe(200);
    expect((await cfg.json()).enabled).toBe(true);

    // Pick a slot from the API (never a hard-coded date). The mock calendar is busy 12:00-13:00
    // local every day, so no returned slot may start at 12:00 or 12:30.
    const slotsRes = await request.get('/api/bookings/slots', { headers: bearer(state.userA) });
    expect(slotsRes.status()).toBe(200);
    const { timeZone, slots } = await slotsRes.json();
    expect(timeZone).toBe('Asia/Jerusalem');
    expect(slots.length).toBeGreaterThan(1);
    expect(slots.some(s => s.time === '12:00' || s.time === '12:30')).toBe(false);
    state.slot = slots[0];

    // First booking creates a HOLD, not a confirmed booking.
    const ok = await book(request, state.userA, state.slot.startsAt);
    expect(ok.status()).toBe(201);
    const body = await ok.json();
    expect(body.booking.status).toBe('pending_payment');
    expect(body.booking.holdExpiresAt).toBeTruthy();
    expect(body.booking.checkoutUrl).toContain('https://shop.e2e.test/cart/12345:1?');
    expect(body.booking.date).toBe(state.slot.date);
    expect(body.booking.time).toBe(state.slot.time);

    // A held slot is taken for everybody else.
    const heldTaken = await book(request, state.userB, state.slot.startsAt);
    expect(heldTaken.status()).toBe(409);
    expect((await heldTaken.json()).code).toBe('slot_taken');

    // The same user booking another slot REPLACES the hold (201, new id), it is not a limit error.
    const replaced = await book(request, state.userA, slots[1].startsAt);
    expect(replaced.status()).toBe(201);
    const replacedBody = await replaced.json();
    expect(replacedBody.booking.id).not.toBe(body.booking.id);
    // The first slot is free again, so book it back; this is the booking we keep using.
    const rebook = await book(request, state.userA, state.slot.startsAt);
    expect(rebook.status()).toBe(201);
    state.bookingId = (await rebook.json()).booking.id;

    // Confirm it with a correctly signed fake Shopify webhook.
    const paid = await payBooking(request, { id: state.bookingId }, state.userA);
    expect(paid.res.status()).toBe(200);
    expect((await paid.res.json()).result).toBe('confirmed');

    // Same user again (a different slot): a CONFIRMED upcoming booking blocks a new one.
    const again = await book(request, state.userA, slots[1].startsAt);
    expect(again.status()).toBe(409);
    expect((await again.json()).code).toBe('limit_reached');

    // Another user, the slot that is now confirmed.
    const taken = await book(request, state.userB, state.slot.startsAt);
    expect(taken.status()).toBe(409);
    expect((await taken.json()).code).toBe('slot_taken');

    // The taken slot is gone from the list.
    const after = await request.get('/api/bookings/slots', { headers: bearer(state.userB) });
    const left = (await after.json()).slots;
    expect(left.some(s => s.startsAt === state.slot.startsAt)).toBe(false);
  });

  // 5. Upcoming list
  test('5. Upcoming tab shows the row with the client email link', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/bookings');
    const r = row(page, state.bookingId);
    await expect(r).toHaveCount(1);
    await expect(r.locator('td.when')).toHaveText(`${state.slot.date} ${state.slot.time}`);
    await expect(r.locator('td.status')).toContainText('Confirmed');
    const client = r.getByRole('link', { name: state.userA.email });
    await expect(client).toHaveAttribute('href', `/admin/users/${state.userA.id}`);
    await expect(r.getByRole('button', { name: 'Cancel booking' })).toBeVisible();
    // The other tabs do not list it.
    await page.getByRole('link', { name: 'Cancelled', exact: true }).click();
    await expect(page).toHaveURL(/tab=cancelled/);
    await expect(row(page, state.bookingId)).toHaveCount(0);
  });

  // 6. User page card
  test('6. the user page has a Bookings card with the booking', async ({ page, context }) => {
    await signIn(context);
    await page.goto(`/admin/users/${state.userA.id}`);
    const card = page.locator('#bookings');
    await expect(card.getByRole('heading', { name: 'Bookings' })).toBeVisible();
    const item = card.locator(`li[data-booking-id="${state.bookingId}"]`);
    await expect(item).toContainText(`${state.slot.date} ${state.slot.time}`);
    await expect(item).toContainText('Confirmed');
    // A user without bookings says so.
    await page.goto(`/admin/users/${state.userB.id}`);
    await expect(page.locator('#bookings')).toContainText('No bookings.');
  });

  // 7. CSRF
  test('7. cancel without or with a wrong _csrf gets 403 and keeps the booking', async ({ page, context }) => {
    await signIn(context);
    for (const extra of [{}, { _csrf: 'wrong-token' }]) {
      const res = await page.request.post(`/admin/bookings/${state.bookingId}/cancel`, { form: extra, maxRedirects: 0 });
      expect(res.status()).toBe(403);
    }
    await page.goto('/admin/bookings');
    await expect(row(page, state.bookingId)).toHaveCount(1);
  });

  // 8. Cancel through the form
  test('8. cancel via the form: notice, row moves to Cancelled, slot is bookable again', async ({ page, context, request }) => {
    await signIn(context);
    // The calendar event is written shortly AFTER payment; wait for it so the cancel really
    // removes an event (the notice below says "removed from the calendar").
    await expect.poll(() => withDb(async ({ Booking }) => {
      const b = await Booking.findById(state.bookingId).lean();
      return b && b.calendarEventId ? 'synced' : 'pending';
    }), { timeout: 15_000 }).toBe('synced');
    // The cancel form asks "are you sure" through a confirm dialog; accept it.
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/admin/bookings');
    await row(page, state.bookingId).getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page).toHaveURL(/\/admin\/bookings/);
    await expect(notice(page)).toHaveText('Booking cancelled and removed from the calendar.');
    await expect(row(page, state.bookingId)).toHaveCount(0);

    // Now in the Cancelled tab, with the client still shown.
    await page.getByRole('link', { name: 'Cancelled', exact: true }).click();
    const r = row(page, state.bookingId);
    await expect(r).toHaveCount(1);
    await expect(r).toContainText(state.userA.email);

    // The user's own list no longer shows it, and the slot can be booked again (by user B).
    const mine = await request.get('/api/bookings/mine', { headers: bearer(state.userA) });
    expect((await mine.json()).upcoming).toBeNull();
    const rebook = await book(request, state.userB, state.slot.startsAt);
    expect(rebook.status()).toBe(201);
    expect((await rebook.json()).booking.status).toBe('pending_payment');
  });

  // 9. Settings page defaults
  test('9. settings page shows the defaults', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/bookings');
    await page.getByRole('link', { name: 'Booking settings' }).click();
    await expect(page).toHaveURL(/\/admin\/booking-settings$/);
    await expect(page.getByRole('heading', { name: 'Booking settings' })).toBeVisible();
    await expect(page.getByText('Time zone: Asia/Jerusalem')).toBeVisible();

    await expect(page.getByLabel('Booking enabled')).toBeChecked();
    await expect(page.getByLabel('Slot length (minutes)')).toHaveValue('30');
    await expect(page.getByLabel('Buffer between consultations (minutes)')).toHaveValue('0');
    await expect(page.getByLabel('Minimum notice (hours)')).toHaveValue('12');
    await expect(page.getByLabel('Booking window (days)')).toHaveValue('30');
    // Sunday-Thursday open 10:00-18:00; Friday and Saturday closed.
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const [d, name] of days.entries()) {
      const enabled = page.locator(`input[name="day${d}_enabled"]`);
      if (d <= 4) {
        await expect(enabled, `${name} should be open`).toBeChecked();
        await expect(page.locator(`input[name="day${d}_open"]`)).toHaveValue('10:00');
        await expect(page.locator(`input[name="day${d}_close"]`)).toHaveValue('18:00');
      } else {
        await expect(enabled, `${name} should be closed`).not.toBeChecked();
      }
    }
  });

  // 10. Save a change
  test('10. saving leadHours 24 shows the saved notice and persists', async ({ page, context, request }) => {
    await signIn(context);
    await page.goto('/admin/booking-settings');
    await page.getByLabel('Minimum notice (hours)').fill('24');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page).toHaveURL(/\/admin\/booking-settings/);
    await expect(notice(page)).toHaveText('Booking settings saved.');
    await page.reload();
    await expect(page.getByLabel('Minimum notice (hours)')).toHaveValue('24');
    // The app-facing config reads the same value.
    const cfg = await request.get('/api/bookings/config', { headers: bearer(state.userA) });
    expect((await cfg.json()).leadHours).toBe(24);
    // Saving again without changes says nothing changed.
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(notice(page)).toHaveText('Nothing changed.');
  });

  // 11. Invalid time
  test('11. an invalid time gives 400, the invalid notice and keeps the typed values', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/booking-settings');
    // A time input cannot hold "25:99", so turn it into a plain text box first.
    await page.locator('input[name="day0_open"]').evaluate(el => { el.type = 'text'; });
    await page.locator('input[name="day0_open"]').fill('25:99');
    await page.getByLabel('Buffer between consultations (minutes)').fill('15');
    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().endsWith('/admin/booking-settings') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Save settings' }).click(),
    ]);
    expect(response.status()).toBe(400);
    await expect(notice(page)).toHaveText(
      'Please check the settings: times must be HH:MM, closing after opening, and the numbers within range.'
    );
    // The form is shown again with what was typed.
    await expect(page.locator('input[name="day0_open"]')).toHaveValue('25:99');
    await expect(page.getByLabel('Buffer between consultations (minutes)')).toHaveValue('15');

    // Nothing was saved: a fresh load still has the old buffer.
    await page.goto('/admin/booking-settings');
    await expect(page.getByLabel('Buffer between consultations (minutes)')).toHaveValue('0');
  });

  // 11b. CSRF on the settings form (review L13a: dropping requireCsrf here was not caught by any test)
  test('11b. saving settings without or with a wrong _csrf gets 403 and saves nothing', async ({ page, context }) => {
    await signIn(context);
    // A fully VALID form body, so the only thing that can stop it is the CSRF check.
    const body = {
      enabled: 'on', slotMinutes: '30', bufferMinutes: '0', leadHours: '99', horizonDays: '30',
      day0_enabled: 'on', day0_open: '10:00', day0_close: '18:00',
    };
    for (const extra of [{}, { _csrf: 'wrong-token' }]) {
      const res = await page.request.post('/admin/booking-settings', { form: { ...body, ...extra }, maxRedirects: 0 });
      expect(res.status()).toBe(403);
    }
    // Nothing was saved: test 10 left leadHours at 24, and it is still 24 (not 99).
    await page.goto('/admin/booking-settings');
    await expect(page.getByLabel('Minimum notice (hours)')).toHaveValue('24');
  });

  // 12. Audit
  test('12. audit log shows booking cancelled and booking settings updated', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/audit');
    await expect(page.getByText('booking cancelled').first()).toBeVisible();
    await expect(page.getByText('booking settings updated').first()).toBeVisible();
    // The cancel entry links to the client (user target).
    await expect(page.locator(`a[href="/admin/users/${state.userA.id}"]`).first()).toBeVisible();
  });

  // ---- Same-day booking setting (2026-10-19, plan AI/plans/booking-calendar-and-fix.md) ----
  // New setting "Allow same-day booking", OFF by default. With it off the server offers no time on
  // today's clinic date (earliest bookable = 00:00 of the next clinic day) and refuses a same-day
  // POST with 422 slot_invalid. These cases run LAST because they change the shared settings.

  // 13. Default + persistence
  test('13. "Allow same-day booking" is unticked by default; ticking and saving persists it', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/booking-settings');
    const box = page.getByLabel('Allow same-day booking');
    await expect(box).not.toBeChecked();

    // Minimum notice is set to 0 as well, so the notice (24 h since test 10) cannot hide today's
    // times: later checks then depend only on this checkbox.
    await page.getByLabel('Minimum notice (hours)').fill('0');
    await box.check();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page).toHaveURL(/\/admin\/booking-settings/);
    await expect(notice(page)).toHaveText('Booking settings saved.');
    await page.reload();
    await expect(page.getByLabel('Allow same-day booking')).toBeChecked();
    // Saving again without changes says nothing changed (the checkbox keeps its value).
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(notice(page)).toHaveText('Nothing changed.');
  });

  // 14. Audit
  test('14. the audit log lists the booking settings change', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/audit');
    // Tests 10 and 13 both wrote "booking settings updated"; test 13's entry names the new field.
    await expect(page.getByText('booking settings updated').first()).toBeVisible();
    await expect(page.getByText('allowSameDay').first()).toBeVisible();
  });

  // 15. The rule itself, through the real API
  test('15. with the setting off, no same-day time is offered and a same-day POST is 422 slot_invalid', async ({ page, context, request }) => {
    // Today's date and time in the clinic's time zone (Asia/Jerusalem), from the real clock.
    const zone = 'Asia/Jerusalem';
    const clinicParts = ms => Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short',
      }).formatToParts(ms).map(p => [p.type, p.value]),
    );
    const now = Date.now();
    const today = (() => { const p = clinicParts(now); return `${p.year}-${p.month}-${p.day}`; })();

    // A candidate same-day start: the next 30 minute boundary at least 60 minutes from now (the
    // clinic zone has whole-hour offsets, so UTC half hours are clinic half hours). It is only a
    // valid booking IF the setting were on when it is on today's date, Sunday-Thursday, inside the
    // 10:00-18:00 opening hours (last start 17:30) and outside the fake calendar's 12:00-13:00 busy time.
    const HALF_HOUR = 30 * 60_000;
    const candidateMs = Math.ceil((now + 60 * 60_000) / HALF_HOUR) * HALF_HOUR;
    const c = clinicParts(candidateMs);
    const hhmm = `${c.hour}:${c.minute}`;
    const usable = `${c.year}-${c.month}-${c.day}` === today
      && ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(c.weekday)
      && hhmm >= '10:00' && hhmm <= '17:30' && !(hhmm >= '12:00' && hhmm < '13:00');

    // Part A (always runs): switch the setting OFF through the form, then check the slot list.
    await signIn(context);
    await page.goto('/admin/booking-settings');
    await page.getByLabel('Allow same-day booking').uncheck();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(notice(page)).toHaveText('Booking settings saved.');

    const res = await request.get('/api/bookings/slots', { headers: bearer(state.userB) });
    expect(res.status()).toBe(200);
    const { slots, taken } = await res.json();
    expect(slots.some(sl => sl.date === today)).toBe(false);
    // Today's times are not in the "taken" list either: they are simply not offered.
    expect(taken.some(sl => sl.date === today)).toBe(false);

    // Part B: a same-day POST. It can only be built when today still has opening hours left in clinic
    // time. Otherwise (late evening, Friday/Saturday, lunch break) the sub-check is skipped on purpose:
    // a time outside the opening hours is refused with slot_invalid whatever the setting is, which
    // would prove nothing about the new rule.
    test.skip(!usable, `no same-day opening time left in clinic time right now (${today} ${hhmm}); POST sub-check skipped`);
    const sameDay = await book(request, state.userB, new Date(candidateMs).toISOString());
    expect(sameDay.status()).toBe(422);
    expect((await sameDay.json()).code).toBe('slot_invalid');
  });

  // 16. Same-day checkbox + an invalid notice value. Nothing is saved (400), so later specs see the
  // settings of test 15 (same-day OFF).
  test('16. ticking "Allow same-day booking" with minimum notice 999 gives 400 and keeps the box ticked', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/booking-settings');
    await page.getByLabel('Allow same-day booking').check();
    await page.getByLabel('Minimum notice (hours)').fill('999');
    // The number input has max=168, so the browser would block the submit: switch its own validation off
    // to reach the SERVER check (the server must refuse 999 on its own).
    await page.locator('form').evaluateAll(forms => forms.forEach(f => { f.noValidate = true; }));
    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().endsWith('/admin/booking-settings') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Save settings' }).click(),
    ]);
    expect(response.status()).toBe(400);
    await expect(notice(page)).toHaveText(
      'Please check the settings: times must be HH:MM, closing after opening, and the numbers within range.'
    );
    // The form comes back with what was typed, including the ticked box.
    await expect(page.getByLabel('Allow same-day booking')).toBeChecked();
    await expect(page.getByLabel('Minimum notice (hours)')).toHaveValue('999');
    // Nothing was saved: a fresh load still has the box unticked.
    await page.goto('/admin/booking-settings');
    await expect(page.getByLabel('Allow same-day booking')).not.toBeChecked();
  });
});
