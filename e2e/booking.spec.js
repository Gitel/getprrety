// 2026-10-19 INTENDED BEHAVIOUR CHANGE (calendar view, plan AI/plans/booking-calendar-and-fix.md):
// the horizontal day chips + time chips were replaced by a Month / Week / Day calendar (new cases in
// booking-calendar.spec.js). The contract keeps testID booking-day-<date> on AVAILABLE day cells and
// booking-slot-<HH:MM> on FREE rows, so nearly every case below is unchanged. What changed here:
//   - the two radiogroup assertions "pick a day" / "pick a time" are KEPT: the Month view wraps its
//     date cells in a radiogroup labelled "pick a day" and the day schedule is a radiogroup labelled
//     "pick a time" (T6 fix M1), so the checked-radio count (exactly one: the focus day cell) and
//     the three free rows are asserted as before.
//   - test title "...and the day chips" now says "day cells".
// Taken times now show as booking-taken-<HH:MM> rows (not booking-slot-*), so slotButtons() still
// counts only FREE rows.
//
// 2026-10-12 INTENDED BEHAVIOUR CHANGE (paid booking, plan AI/plans/paid-booking-and-signin-link.md):
// booking is no longer confirmed at once. The confirm button now reads "Continue to payment" and
// POST /api/bookings answers a 15 minute HOLD (status pending_payment), so the screen shows the
// "awaiting payment" panel instead of the confirmed card. The confirmed card appears only after
// payment (covered in booking-payment.spec.js). The other cases below are unchanged.
//
// In-app booking screen (test-first: written BEFORE the screen exists, so it is red until the
// build lands). Contract: AI/plans/in-app-booking-contract.md sections 8-10.
//
// How the screen is reached: Home -> side menu -> "Book a consultation" (the row only shows
// when GET /api/bookings/config says enabled). The mock serves the fixture slots
// (fixtures-data.js BOOKING_SLOTS): Thu 2026-10-01 10:00 / 10:30 / 11:00 and Sun 2026-10-04
// 10:00 / 10:30 in clinic time. Booking texts are written out below (taken from the contract)
// instead of read from the locale files, so a typo in a locale file is caught here.
import { test, expect } from './support/test.js';
import { makeT } from './support/i18n.js';
import { openMenu, panelOf, openBooking } from './support/nav.js';
import { edgeSwipe } from './support/touch.js';
import { BOOKING_SLOTS, BOOKING_UPCOMING } from './support/fixtures-data.js';

const tHe = makeT('he');

// English texts (contract section 6 error table and section 8 booking.json).
const EN = {
  slotTaken: 'Sorry, that time was just taken. Please choose another.',
  limitReached: 'You already have an upcoming consultation. To change it, message the clinic.',
  unavailable: 'We cannot reach the clinic calendar right now. Please try again in a moment.',
  empty: 'There are no free times right now. Please check back soon, or message the clinic.',
  noAnalysis: 'You have not completed your skin analysis yet. You can still book, but finishing it first helps the clinic prepare.',
  title: 'Book a consultation',
  subtitle: "Choose a time that suits you. Times are in the clinic's local time.",
  confirmedTitle: 'Your consultation is booked',
  continueToPayment: 'Continue to payment',
  upcomingTitle: 'Your upcoming consultation',
};
// Hebrew texts for the RTL cases.
const HE = {
  title: 'קבעו ייעוץ',
  subtitle: 'בחרו מועד שנוח לכם. השעות לפי שעון הקליניקה.',
  confirmedTitle: 'הייעוץ שלכם נקבע',
  upcomingTitle: 'הייעוץ הקרוב שלכם',
};

test.use({ signedIn: true });

const homeIsShowing = (page, t) => expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
// Every time button of the selected day (testID booking-slot-<HH:MM>).
const slotButtons = page => page.locator('[data-testid^="booking-slot-"]');
// Confirm is a Pressable (a div): "disabled" shows as aria-disabled="true".
const confirmBtn = page => page.getByTestId('booking-confirm');

test.describe('opening and the picker (English)', () => {
  test('the menu item opens the screen with the title, subtitle and the day cells', async ({ page, mock, t }) => {
    await openBooking(page, t);
    const screen = page.getByTestId('booking-screen');
    await expect(screen).toContainText(EN.title);
    await expect(screen).toContainText(EN.subtitle);
    // Loaded: one cell per day that has free slots, and the screen asked for both lists once.
    await expect(page.getByTestId('booking-loading')).toHaveCount(0);
    await expect(page.getByTestId('booking-day-2026-10-01')).toBeVisible();
    await expect(page.getByTestId('booking-day-2026-10-04')).toBeVisible();
    expect(mock.callsTo('GET', '/api/bookings/slots')).toHaveLength(1);
    expect(mock.callsTo('GET', '/api/bookings/mine')).toHaveLength(1);
    expect(mock.lastCall('GET', '/api/bookings/slots').authed).toBe(true);
    // No upcoming booking: the picker is shown, not the upcoming card.
    await expect(page.getByTestId('booking-upcoming')).toHaveCount(0);
  });

  test('the first day is preselected; its times show, nothing is picked, confirm is disabled', async ({ page, t }) => {
    await openBooking(page, t);
    await expect(page.getByTestId('booking-day-2026-10-01')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('booking-day-2026-10-04')).toHaveAttribute('aria-checked', 'false');
    // The focus day cell is a radio, so a screen reader announces it as selected (free rows are unchecked radios).
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1);
    // N-4: the date cells and the time rows are two separate labelled radio groups.
    await expect(page.getByRole('radiogroup', { name: t('booking:pickDay') })).toHaveCount(1);
    await expect(page.getByRole('radiogroup', { name: t('booking:pickTime') })).toHaveCount(1);
    // Day 1 has three times (24 h, clinic time), none selected.
    await expect(slotButtons(page)).toHaveCount(3);
    for (const time of ['10:00', '10:30', '11:00']) {
      await expect(page.getByTestId(`booking-slot-${time}`)).toHaveAttribute('aria-checked', 'false');
    }
    await expect(page.getByTestId('booking-selected')).toHaveCount(0);
    await expect(confirmBtn(page)).toHaveAttribute('aria-disabled', 'true');
  });

  test('choosing another day swaps the time buttons', async ({ page, t }) => {
    await openBooking(page, t);
    await page.getByTestId('booking-day-2026-10-04').click();
    await expect(page.getByTestId('booking-day-2026-10-04')).toHaveAttribute('aria-checked', 'true');
    await expect(slotButtons(page)).toHaveCount(2);
    await expect(page.getByTestId('booking-slot-11:00')).toHaveCount(0); // only Thursday has 11:00
    await expect(page.getByTestId('booking-slot-10:30')).toBeVisible();
  });

  test('picking a time shows the summary and enables confirm', async ({ page, t }) => {
    await openBooking(page, t);
    await page.getByTestId('booking-slot-10:30').click();
    await expect(page.getByTestId('booking-slot-10:30')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('booking-selected')).toContainText('Your appointment: Thu, 1 October, 10:30 AM');
    await expect(confirmBtn(page)).not.toHaveAttribute('aria-disabled', 'true');
    // Paid flow: the button leads to payment, it does not book straight away.
    await expect(confirmBtn(page)).toContainText(EN.continueToPayment);
  });
});

test.describe('booking', () => {
  test('confirming holds the slot: POST body, awaiting-payment panel, picker gone, not confirmed yet', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await page.getByTestId('booking-slot-10:00').click();
    await confirmBtn(page).click();

    const waiting = page.getByTestId('booking-awaiting-payment');
    await expect(waiting).toBeVisible();
    await expect(waiting).toContainText(t('booking:awaitingTitle'));
    await expect(page.getByTestId('booking-pay-now')).toBeVisible();
    await expect(slotButtons(page)).toHaveCount(0);
    // Paid only after payment: no confirmed card yet.
    await expect(page.getByTestId('booking-confirmed')).toHaveCount(0);
    // The analysis exists in the fixtures, so there is no warning.
    await expect(page.getByTestId('booking-no-analysis-warning')).toHaveCount(0);

    // One POST, authed, with the UTC instant of the chosen slot and the (empty) note.
    const posts = mock.callsTo('POST', '/api/bookings');
    expect(posts).toHaveLength(1);
    expect(posts[0].authed).toBe(true);
    expect(posts[0].body).toEqual({ startsAt: BOOKING_SLOTS[0].startsAt, note: '' });
  });

  test('the note is sent with the booking', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await page.getByTestId('booking-slot-10:30').click();
    await page.getByTestId('booking-note').fill('First visit, sensitive skin');
    await confirmBtn(page).click();
    await expect(page.getByTestId('booking-awaiting-payment')).toBeVisible();
    expect(mock.lastCall('POST', '/api/bookings').body).toEqual({
      startsAt: BOOKING_SLOTS[1].startsAt, note: 'First visit, sensitive skin',
    });
  });

  test('slot_taken: shows the text, clears the pick, refetches the slots (2 calls), the slot is gone', async ({ page, mock, t }) => {
    mock.booking({ slotTakenOnce: true });
    await openBooking(page, t);
    await page.getByTestId('booking-slot-10:00').click();
    await confirmBtn(page).click();

    await expect(page.getByTestId('booking-submit-error')).toContainText(EN.slotTaken);
    await expect.poll(() => mock.callsTo('GET', '/api/bookings/slots').length).toBe(2);
    // The mock dropped 10:00 of Thursday; Thursday keeps 10:30 and 11:00.
    await expect(page.getByTestId('booking-slot-10:00')).toHaveCount(0);
    await expect(page.getByTestId('booking-slot-10:30')).toBeVisible();
    await expect(page.getByTestId('booking-selected')).toHaveCount(0);
    await expect(page.getByTestId('booking-awaiting-payment')).toHaveCount(0);
  });

  test('limit_reached: shows the text and refetches "mine"', async ({ page, mock, t }) => {
    mock.override('POST', '/api/bookings', 409, { error: 'x', code: 'limit_reached' });
    await openBooking(page, t);
    await page.getByTestId('booking-slot-10:00').click();
    await confirmBtn(page).click();
    await expect(page.getByTestId('booking-submit-error')).toContainText(EN.limitReached);
    await expect.poll(() => mock.callsTo('GET', '/api/bookings/mine').length).toBe(2);
    await expect(page.getByTestId('booking-awaiting-payment')).toHaveCount(0);
  });

  test('a booking without a saved analysis still succeeds and shows the warning', async ({ page, mock, t }) => {
    // The server answers 201 with warning "no_analysis" (soft check, never a block). The booking is
    // a payment hold now. ASSUMPTION: the warning is shown next to the awaiting-payment panel.
    const hold = {
      ...BOOKING_UPCOMING, id: 'booking-new', status: 'pending_payment',
      holdExpiresAt: '2026-09-29T09:15:00.000Z', checkoutUrl: 'https://shop.e2e.test/cart/12345:1?x=1',
    };
    mock.override('POST', '/api/bookings', 201, { booking: hold, warning: 'no_analysis' });
    await openBooking(page, t);
    await page.getByTestId('booking-slot-10:00').click();
    await confirmBtn(page).click();
    await expect(page.getByTestId('booking-awaiting-payment')).toBeVisible();
    await expect(page.getByTestId('booking-no-analysis-warning')).toContainText(EN.noAnalysis);
  });
});

test.describe('other states', () => {
  test('an existing upcoming booking shows its card instead of the picker; the clinic button opens Messages', async ({ page, mock, t }) => {
    mock.booking({ upcoming: BOOKING_UPCOMING });
    await openBooking(page, t);
    await expect(page.getByTestId('booking-upcoming')).toContainText(EN.upcomingTitle);
    await expect(page.getByTestId('booking-upcoming-when')).toContainText('Sun, 4 October');
    await expect(page.getByTestId('booking-upcoming-when')).toContainText('10:00 AM');
    await expect(slotButtons(page)).toHaveCount(0);
    await expect(confirmBtn(page)).toHaveCount(0);

    await page.getByTestId('booking-message-clinic').click();
    await expect(page.getByText(t('messages:title'), { exact: true })).toBeVisible();
    await expect(page.getByTestId('booking-screen')).toHaveCount(0);
  });

  // A consultation bought directly in the Shopify store (plan AI/plans/shopify-consultation-link.md,
  // D2/D7): shown above the picker, never instead of it, with a "Something wrong?" link to Messages.
  test('a Shopify appointment shows above the picker; the picker stays for another consultation', async ({ page, mock, t }) => {
    mock.booking({ shopifyConsultation: {
      orderName: '#1042', paidAt: '2026-09-28T09:00:00.000Z',
      appointment: { startsAt: '2026-10-04T07:00:00.000Z', endsAt: '2026-10-04T07:30:00.000Z', date: '2026-10-04', time: '10:00' },
    } });
    await openBooking(page, t);
    const card = page.getByTestId('booking-shopify');
    await expect(card).toContainText(t('booking:shopifyTitle'));
    await expect(page.getByTestId('booking-shopify-when')).toContainText('Sun, 4 October');
    await expect(card).toContainText(t('booking:shopifyBooked'));
    await expect(page.getByTestId('booking-shopify-help')).toContainText(t('booking:shopifyHelpTitle'));
    // Never blocks booking more: the picker is still there, labelled as "another" consultation.
    await expect(page.getByTestId('booking-book-another')).toHaveText(t('booking:bookAnother'));
    await expect(confirmBtn(page)).toBeVisible();

    await page.getByTestId('booking-shopify-message').click();
    await expect(page.getByText(t('messages:title'), { exact: true })).toBeVisible();
  });

  test('a Shopify order without a found time says the payment arrived, and keeps the picker', async ({ page, mock, t }) => {
    mock.booking({ shopifyConsultation: { orderName: '#1042', paidAt: '2026-09-28T09:00:00.000Z', appointment: null } });
    await openBooking(page, t);
    await expect(page.getByTestId('booking-shopify')).toContainText(t('booking:shopifyNoTime'));
    await expect(page.getByTestId('booking-shopify-when')).toHaveCount(0);
    await expect(page.getByTestId('booking-shopify-help')).toBeVisible();
    await expect(confirmBtn(page)).toBeVisible();
  });

  test('no Shopify order: no Shopify card and no "another" label', async ({ page, t }) => {
    await openBooking(page, t);
    await expect(confirmBtn(page)).toBeVisible();
    await expect(page.getByTestId('booking-shopify')).toHaveCount(0);
    await expect(page.getByTestId('booking-book-another')).toHaveCount(0);
  });

  test('a calendar outage (503) shows the error with a retry; retrying loads the slots', async ({ page, mock, t }) => {
    mock.override('GET', '/api/bookings/slots', 503, { error: 'x', code: 'calendar_unavailable' });
    await openBooking(page, t);
    await expect(page.getByTestId('booking-error')).toContainText(EN.unavailable);
    await expect(slotButtons(page)).toHaveCount(0);

    // The calendar is back: remove the forced answer, then retry.
    mock.clearOverride('GET', '/api/bookings/slots');
    await page.getByTestId('booking-retry').click();
    await expect(page.getByTestId('booking-slot-10:00')).toBeVisible();
    await expect(page.getByTestId('booking-error')).toHaveCount(0);
    expect(mock.callsTo('GET', '/api/bookings/slots')).toHaveLength(2);
  });

  test('no free times shows the empty text', async ({ page, mock, t }) => {
    mock.booking({ slots: [] });
    await openBooking(page, t);
    await expect(page.getByTestId('booking-empty')).toContainText(EN.empty);
    await expect(slotButtons(page)).toHaveCount(0);
  });

  test('the menu item is hidden when booking is disabled on the server', async ({ page, mock, t }) => {
    mock.booking({ enabled: false });
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    // Wait for the config answer first, otherwise "hidden" would be true only because it is not loaded yet.
    await expect.poll(() => mock.callsTo('GET', '/api/bookings/config').length).toBeGreaterThan(0);
    await expect(panelOf(page, t).getByText(t('menu:settings'), { exact: true })).toBeVisible();
    await expect(panelOf(page, t).getByText(t('menu:book'), { exact: true })).toHaveCount(0);
  });

  test('the edge swipe returns to Home (no Back button on the screen)', async ({ page, t }) => {
    await openBooking(page, t);
    await edgeSwipe(page, { lang: 'en', dx: 234 });
    await homeIsShowing(page, t);
    await expect(page.getByTestId('booking-screen')).toHaveCount(0);
  });
});

test.describe('Hebrew (RTL)', () => {
  test.use({ lang: 'he' });

  test('texts are Hebrew, the page is RTL, times are 24 h; booking shows the Hebrew payment panel', async ({ page, mock }) => {
    await openBooking(page, tHe);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const screen = page.getByTestId('booking-screen');
    await expect(screen).toContainText(HE.title);
    await expect(screen).toContainText(HE.subtitle);
    // 24 h times, no AM/PM.
    await expect(page.getByTestId('booking-slot-10:00')).toContainText('10:00');
    await expect(page.getByTestId('booking-slot-10:00')).not.toContainText(/AM|PM/);

    await page.getByTestId('booking-slot-10:00').click();
    await expect(page.getByTestId('booking-selected')).toContainText('10:00');
    await expect(page.getByTestId('booking-selected')).not.toContainText(/AM|PM/);
    await expect(page.getByTestId('booking-confirm')).toContainText(tHe('booking:continueToPayment'));
    await page.getByTestId('booking-confirm').click();
    // The waiting panel is Hebrew (title from the Hebrew locale file) and its hold time is 24 h.
    await expect(page.getByTestId('booking-awaiting-payment')).toContainText(tHe('booking:awaitingTitle'));
    await expect(page.getByTestId('booking-hold-until')).not.toContainText(/AM|PM/);
    expect(mock.lastCall('POST', '/api/bookings').body.startsAt).toBe(BOOKING_SLOTS[0].startsAt);
  });

  test('the upcoming card is Hebrew and the edge swipe (from the right edge) returns to Home', async ({ page, mock }) => {
    mock.booking({ upcoming: BOOKING_UPCOMING });
    await openBooking(page, tHe);
    await expect(page.getByTestId('booking-upcoming')).toContainText(HE.upcomingTitle);
    await expect(page.getByTestId('booking-upcoming-when')).toContainText('10:00');
    await edgeSwipe(page, { lang: 'he', dx: 234 });
    await homeIsShowing(page, tHe);
    await expect(page.getByTestId('booking-screen')).toHaveCount(0);
  });
});
