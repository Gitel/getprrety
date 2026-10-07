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
  test('the menu item opens the screen with the title, subtitle and the day chips', async ({ page, mock, t }) => {
    await openBooking(page, t);
    const screen = page.getByTestId('booking-screen');
    await expect(screen).toContainText(EN.title);
    await expect(screen).toContainText(EN.subtitle);
    // Loaded: one chip per day that has slots, and the screen asked for both lists once.
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
    // The chips are radios, so a screen reader announces the checked one as selected.
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1);
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
  });
});

test.describe('booking', () => {
  test('confirming books the slot: POST body, confirmed panel with the time, picker gone', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await page.getByTestId('booking-slot-10:00').click();
    await confirmBtn(page).click();

    const confirmed = page.getByTestId('booking-confirmed');
    await expect(confirmed).toBeVisible();
    await expect(confirmed).toContainText(EN.confirmedTitle);
    await expect(page.getByTestId('booking-confirmed-when')).toContainText('Thu, 1 October');
    await expect(page.getByTestId('booking-confirmed-when')).toContainText('10:00 AM');
    await expect(slotButtons(page)).toHaveCount(0);
    // The analysis exists in the fixtures, so there is no warning.
    await expect(page.getByTestId('booking-no-analysis-warning')).toHaveCount(0);

    // One POST, authed, with the UTC instant of the chosen slot and the (empty) note.
    const posts = mock.callsTo('POST', '/api/bookings');
    expect(posts).toHaveLength(1);
    expect(posts[0].authed).toBe(true);
    expect(posts[0].body).toEqual({ startsAt: BOOKING_SLOTS[0].startsAt, note: '' });
    // The screen refreshes "mine" after success (1 on mount + 1 after booking).
    await expect.poll(() => mock.callsTo('GET', '/api/bookings/mine').length).toBe(2);
  });

  test('the note is sent with the booking', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await page.getByTestId('booking-slot-10:30').click();
    await page.getByTestId('booking-note').fill('First visit, sensitive skin');
    await confirmBtn(page).click();
    await expect(page.getByTestId('booking-confirmed')).toBeVisible();
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
    await expect(page.getByTestId('booking-confirmed')).toHaveCount(0);
  });

  test('limit_reached: shows the text and refetches "mine"', async ({ page, mock, t }) => {
    mock.override('POST', '/api/bookings', 409, { error: 'x', code: 'limit_reached' });
    await openBooking(page, t);
    await page.getByTestId('booking-slot-10:00').click();
    await confirmBtn(page).click();
    await expect(page.getByTestId('booking-submit-error')).toContainText(EN.limitReached);
    await expect.poll(() => mock.callsTo('GET', '/api/bookings/mine').length).toBe(2);
    await expect(page.getByTestId('booking-confirmed')).toHaveCount(0);
  });

  test('a booking without a saved analysis still succeeds and shows the warning', async ({ page, mock, t }) => {
    // The server answers 201 with warning "no_analysis" (soft check, never a block).
    mock.override('POST', '/api/bookings', 201, { booking: BOOKING_UPCOMING, warning: 'no_analysis' });
    await openBooking(page, t);
    await page.getByTestId('booking-slot-10:00').click();
    await confirmBtn(page).click();
    await expect(page.getByTestId('booking-confirmed')).toBeVisible();
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

  test('texts are Hebrew, the page is RTL, times are 24 h; booking confirms in Hebrew', async ({ page, mock }) => {
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
    await page.getByTestId('booking-confirm').click();
    await expect(page.getByTestId('booking-confirmed')).toContainText(HE.confirmedTitle);
    await expect(page.getByTestId('booking-confirmed-when')).toContainText('10:00');
    await expect(page.getByTestId('booking-confirmed-when')).not.toContainText(/AM|PM/);
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
