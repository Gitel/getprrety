// Paid booking flow (test-first, written 2026-10-12 BEFORE the client code exists, so it is red
// until the screens land). Contract: AI/plans/paid-booking-and-signin-link-contract.md section 6.
//
// The flow under test:
//   1. pick a slot -> "Continue to payment" -> POST /api/bookings answers a 15 minute HOLD
//      (status pending_payment, holdExpiresAt, checkoutUrl);
//   2. the screen shows the "awaiting payment" panel with the hold time (clinic time) and a
//      "Pay now" button that opens the Shopify checkout in a pop-up;
//   3. while the panel shows, the screen polls GET /api/bookings/mine every 5 s (and on app
//      resume). After payment the booking is confirmed -> confirmed card; if the hold runs
//      out -> "time ran out" notice + the picker again.
// The mock (support/mock-api.js) plays the server: mock.payBooking() = the Shopify webhook
// arrived, mock.expireHold() = the 15 minutes passed. The checkout host shop.e2e.test is answered
// with a tiny HTML page, so the pop-up really loads.
import { test, expect } from './support/test.js';
import { makeT } from './support/i18n.js';
import { openBooking, openMenu, tapMenuItem } from './support/nav.js';
import { BOOKING_SLOTS } from './support/fixtures-data.js';

const tHe = makeT('he');
const CHECKOUT_PREFIX = 'https://shop.e2e.test/cart/12345:1';

test.use({ signedIn: true });

const confirmBtn = page => page.getByTestId('booking-confirm');
const waiting = page => page.getByTestId('booking-awaiting-payment');

// Picks the 10:00 slot of the first day and taps "Continue to payment"; waits for the waiting panel.
async function holdFirstSlot(page) {
  // Month view (round 2): the day cell opens a pop-up; the time button inside it closes it again.
  await page.getByTestId('booking-day-2026-10-01').click();
  await page.getByTestId('booking-slot-10:00').click();
  await confirmBtn(page).click();
  await expect(waiting(page)).toBeVisible();
}

// Regex for the clinic-time HH:MM of an ISO instant. English may show 24 h ("12:15") or 12 h
// ("12:15 PM"), so both are accepted; Hebrew is always 24 h. Clinic zone = Asia/Jerusalem.
function clinicTimeRegex(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hh = parts.find(p => p.type === 'hour').value;
  const mm = parts.find(p => p.type === 'minute').value;
  const h12 = String(Number(hh) % 12 || 12);
  return new RegExp(`(${hh}:${mm})|(${h12}:${mm}\\s?(AM|PM))`);
}

test.describe('the payment hold (English)', () => {
  test('continue to payment: POST body, waiting panel with the hold time, pay now, no confirmation yet', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await holdFirstSlot(page);

    // One POST with the UTC instant and the note, like before.
    const posts = mock.callsTo('POST', '/api/bookings');
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ startsAt: BOOKING_SLOTS[0].startsAt, note: '' });

    // The panel: title, hold time (clinic time of holdExpiresAt), pay + choose-other buttons.
    await expect(waiting(page)).toContainText(t('booking:awaitingTitle'));
    const hold = mock.state.booking.upcoming;
    expect(hold.status).toBe('pending_payment');
    await expect(page.getByTestId('booking-hold-until')).toContainText(clinicTimeRegex(hold.holdExpiresAt));
    await expect(page.getByTestId('booking-pay-now')).toContainText(t('booking:payNow'));
    await expect(page.getByTestId('booking-choose-other')).toContainText(t('booking:chooseOther'));
    // Not paid yet: no confirmed card, no picker.
    await expect(page.getByTestId('booking-confirmed')).toHaveCount(0);
    await expect(page.locator('[data-testid^="booking-slot-"]')).toHaveCount(0);
  });

  test('"Pay now" opens the checkout pop-up at the shop cart link', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await holdFirstSlot(page);

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByTestId('booking-pay-now').click(),
    ]);
    await popup.waitForLoadState();
    expect(popup.url().startsWith(CHECKOUT_PREFIX)).toBe(true);
    // The link carries the booking id and the (encoded) user email, as the mock built it.
    expect(popup.url()).toContain('attributes%5Bgetpretty_booking%5D=booking-new');
    expect(popup.url()).toContain(`checkout%5Bemail%5D=${encodeURIComponent('dana@example.test')}`);
    // The checkout host was answered by the mock, so it is not a blocked host.
    expect(mock.blockedHosts()).toEqual([]);
    await popup.close();
  });

  test('after payment the polling shows the confirmed card by itself', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await holdFirstSlot(page);

    mock.payBooking(); // the Shopify webhook arrived
    // Polling is every 5 s, so allow ~12 s.
    const confirmed = page.getByTestId('booking-confirmed');
    await expect(confirmed).toBeVisible({ timeout: 12_000 });
    await expect(confirmed).toContainText(t('booking:confirmedTitle'));
    await expect(waiting(page)).toHaveCount(0);
  });

  test('returning to the app (visibilitychange) refreshes after payment', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await holdFirstSlot(page);

    mock.payBooking();
    // The resume refresh listens to visibilitychange while the tab is visible.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByTestId('booking-confirmed')).toBeVisible({ timeout: 12_000 });
  });

  test('when the hold runs out: "time ran out" notice and the picker with the slot back', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await holdFirstSlot(page);

    mock.expireHold(); // 15 minutes passed, the slot is free again
    const expired = page.getByTestId('booking-hold-expired');
    await expect(expired).toBeVisible({ timeout: 12_000 });
    await expect(expired).toContainText(t('booking:holdExpired'));
    await expect(waiting(page)).toHaveCount(0);
    // The picker is back and the slots were reloaded (the held slot is bookable again).
    await page.getByTestId('booking-day-2026-10-01').click();
    await expect(page.getByTestId('booking-slot-10:00')).toBeVisible();
  });

  test('"choose another time" returns to the picker; a second booking replaces the hold', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await holdFirstSlot(page);

    await page.getByTestId('booking-choose-other').click();
    await expect(waiting(page)).toHaveCount(0);
    await page.getByTestId('booking-day-2026-10-01').click();
    await expect(page.getByTestId('booking-slot-10:30')).toBeVisible();
    // Going back makes no server call by itself: still one POST.
    expect(mock.callsTo('POST', '/api/bookings')).toHaveLength(1);

    await page.getByTestId('booking-slot-10:30').click();
    await confirmBtn(page).click();
    await expect(waiting(page)).toBeVisible();

    // Second POST seen; the mock now holds 10:30 and gave the 10:00 slot back.
    const posts = mock.callsTo('POST', '/api/bookings');
    expect(posts).toHaveLength(2);
    expect(posts[1].body.startsAt).toBe(BOOKING_SLOTS[1].startsAt);
    expect(mock.state.booking.upcoming.startsAt).toBe(BOOKING_SLOTS[1].startsAt);
    expect(mock.state.booking.slots.map(s => s.startsAt)).toContain(BOOKING_SLOTS[0].startsAt);
  });

  // Polling must stop when the waiting panel is gone (no wasted calls, no timers left running).
  test('no more /bookings/mine polling after "choose another time"', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await holdFirstSlot(page);
    await page.getByTestId('booking-choose-other').click();
    await expect(waiting(page)).toHaveCount(0);

    const before = mock.callsTo('GET', '/api/bookings/mine').length;
    await page.waitForTimeout(6000); // longer than one 5 s polling interval
    expect(mock.callsTo('GET', '/api/bookings/mine').length).toBe(before);
  });

  test('no more /bookings/mine polling after leaving the booking screen', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await holdFirstSlot(page);
    // Leave through the side menu (Settings).
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:settings');
    await expect(page.getByTestId('booking-screen')).toHaveCount(0);

    const before = mock.callsTo('GET', '/api/bookings/mine').length;
    await page.waitForTimeout(6000);
    expect(mock.callsTo('GET', '/api/bookings/mine').length).toBe(before);
  });

  test('reloading while a hold is live shows the waiting panel again (pending upcoming from /mine)', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await holdFirstSlot(page);

    // The app has no URLs, so a reload lands on Home; open the booking screen again.
    await openBooking(page, t);
    await expect(waiting(page)).toBeVisible();
    await expect(page.getByTestId('booking-hold-until')).toContainText(clinicTimeRegex(mock.state.booking.upcoming.holdExpiresAt));
    await expect(page.getByTestId('booking-pay-now')).toBeVisible();
    await expect(page.locator('[data-testid^="booking-slot-"]')).toHaveCount(0);
  });
});

test.describe('the payment hold (Hebrew, RTL)', () => {
  test.use({ lang: 'he' });

  test('the waiting panel is Hebrew, RTL, with a 24 h hold time', async ({ page, mock }) => {
    await openBooking(page, tHe);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(confirmBtn(page)).toHaveCount(1); // the picker is showing
    await holdFirstSlot(page);

    await expect(waiting(page)).toContainText(tHe('booking:awaitingTitle'));
    await expect(page.getByTestId('booking-pay-now')).toContainText(tHe('booking:payNow'));
    await expect(page.getByTestId('booking-choose-other')).toContainText(tHe('booking:chooseOther'));
    const hold = mock.state.booking.upcoming;
    await expect(page.getByTestId('booking-hold-until')).toContainText(clinicTimeRegex(hold.holdExpiresAt));
    await expect(page.getByTestId('booking-hold-until')).not.toContainText(/AM|PM/);
  });
});
