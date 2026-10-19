// Booking calendar views (plan AI/plans/booking-calendar-and-fix.md, contract
// AI/plans/booking-calendar-contract.md). Written TEST-FIRST: the Month / Week / Day views did not
// exist when this file was written, so it is red until the client build lands.
//
// Data (fixtures-data.js, page clock = Tue 2026-09-29, clinic 12:00, so "today" = 2026-09-29):
//   - FREE  (BOOKING_SLOTS): Thu 2026-10-01 10:00 / 10:30 / 11:00, Sun 2026-10-04 10:00 / 10:30.
//   - TAKEN (BOOKING_TAKEN): Thu 2026-10-01 11:30 / 12:00, Sun 2026-10-04 11:00,
//                            Mon 2026-10-05 10:00 / 10:30 (no free time -> a "fully booked" day).
// The screen opens in Month view with the first available day (2026-10-01) as the focus.
// English texts below are copied literally from contract section 7 (so a typo in a locale file is
// caught); the Hebrew table is also literal, and a few keys are cross-checked via makeT('he').
import { test, expect } from './support/test.js';
import { makeT } from './support/i18n.js';
import { openBooking } from './support/nav.js';
import { BOOKING_SLOTS } from './support/fixtures-data.js';

const tHe = makeT('he');

// Contract section 7, English column.
const EN = {
  taken: 'Taken',
  available: 'Available',
  yourTime: 'Your time',
  legendAvailable: 'Available',
  legendFull: 'Fully booked',
  closedDay: 'There are no times on this day.',
  continueToPayment: 'Continue to payment',
};
// Contract section 7, Hebrew column.
const HE = {
  viewMonth: 'חודש',
  viewWeek: 'שבוע',
  viewDay: 'יום',
  taken: 'תפוס',
  available: 'פנוי',
  yourTime: 'המועד שלכם',
  legendAvailable: 'יש מועדים פנויים',
  legendFull: 'מלא',
  closedDay: 'אין מועדים ביום הזה.',
  prevMonth: 'החודש הקודם',
  nextDay: 'היום הבא',
};

test.use({ signedIn: true });

const tid = (page, id) => page.getByTestId(id);
const confirmBtn = page => tid(page, 'booking-confirm');
// Rows of the day schedule: free rows and taken rows have different test id prefixes.
const freeRows = page => page.locator('[data-testid^="booking-slot-"]');
const takenRows = page => page.locator('[data-testid^="booking-taken-"]');

test.describe('Month view (English)', () => {
  test('opens in Month view, labelled October 2026, with the first available day focused', async ({ page, t }) => {
    await openBooking(page, t);
    await expect(tid(page, 'booking-view-month')).toHaveAttribute('aria-selected', 'true');
    await expect(tid(page, 'booking-view-week')).toHaveAttribute('aria-selected', 'false');
    await expect(tid(page, 'booking-view-day')).toHaveAttribute('aria-selected', 'false');
    await expect(tid(page, 'booking-month-label')).toHaveText('October 2026');
    // 2026-10-01 is the first day with a free time: it is the focus (filled circle = checked radio).
    await expect(tid(page, 'booking-day-2026-10-01')).toHaveAttribute('aria-checked', 'true');
    await expect(tid(page, 'booking-day-2026-10-04')).toHaveAttribute('aria-checked', 'false');
  });

  test('the focus day schedule lists free rows and taken rows with the "Taken" text', async ({ page, t }) => {
    await openBooking(page, t);
    await expect(freeRows(page)).toHaveCount(3);
    for (const time of ['10:00', '10:30', '11:00']) {
      await expect(tid(page, `booking-slot-${time}`)).toContainText(EN.available);
    }
    await expect(takenRows(page)).toHaveCount(2);
    for (const time of ['11:30', '12:00']) {
      const row = tid(page, `booking-taken-${time}`);
      await expect(row).toContainText(EN.taken);
      await expect(row).toHaveAttribute('aria-disabled', 'true');
    }
  });

  test('a taken row cannot be selected: nothing is picked and confirm stays disabled', async ({ page, t }) => {
    await openBooking(page, t);
    await tid(page, 'booking-taken-11:30').click();
    await expect(tid(page, 'booking-selected')).toHaveCount(0);
    await expect(confirmBtn(page)).toHaveAttribute('aria-disabled', 'true');
    // No free row became checked either.
    await expect(page.locator('[data-testid^="booking-slot-"][aria-checked="true"]')).toHaveCount(0);
  });

  test('a free row is selected on tap and its text becomes "Your time"', async ({ page, t }) => {
    await openBooking(page, t);
    await tid(page, 'booking-slot-10:30').click();
    await expect(tid(page, 'booking-slot-10:30')).toHaveAttribute('aria-checked', 'true');
    await expect(tid(page, 'booking-slot-10:30')).toContainText(EN.yourTime);
    await expect(confirmBtn(page)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('2026-10-05 is a fully booked cell: tapping it shows only taken rows', async ({ page, t }) => {
    await openBooking(page, t);
    const cell = tid(page, 'booking-day-full-2026-10-05');
    await expect(cell).toBeVisible();
    await cell.click();
    await expect(takenRows(page)).toHaveCount(2);
    await expect(tid(page, 'booking-taken-10:00')).toContainText(EN.taken);
    await expect(tid(page, 'booking-taken-10:30')).toContainText(EN.taken);
    await expect(freeRows(page)).toHaveCount(0);
    await expect(confirmBtn(page)).toHaveAttribute('aria-disabled', 'true');
  });

  // (The same-day guarantee itself, i.e. why today is never offered, is covered by the server tests.)
  test('today (2026-09-29) is never an available cell; it is "off" when September is shown', async ({ page, t }) => {
    await openBooking(page, t);
    await tid(page, 'booking-month-prev').click();
    await expect(tid(page, 'booking-month-label')).toHaveText('September 2026');
    await expect(tid(page, 'booking-day-off-2026-09-29')).toBeVisible();
    await expect(tid(page, 'booking-day-2026-09-29')).toHaveCount(0);
    await expect(tid(page, 'booking-day-full-2026-09-29')).toHaveCount(0);
  });

  test('the legend is visible with both entries', async ({ page, t }) => {
    await openBooking(page, t);
    const legend = tid(page, 'booking-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText(EN.legendAvailable);
    await expect(legend).toContainText(EN.legendFull);
  });

  test('the month arrows are disabled at the range edges (today .. last offered day)', async ({ page, t }) => {
    await openBooking(page, t);
    // October: the last offered day is 2026-10-05, so there is nothing after October.
    await expect(tid(page, 'booking-month-next')).toHaveAttribute('aria-disabled', 'true');
    await expect(tid(page, 'booking-month-prev')).not.toHaveAttribute('aria-disabled', 'true');
    // September holds today, the first day of the range, so nothing before it.
    await tid(page, 'booking-month-prev').click();
    await expect(tid(page, 'booking-month-prev')).toHaveAttribute('aria-disabled', 'true');
    await expect(tid(page, 'booking-month-next')).not.toHaveAttribute('aria-disabled', 'true');
    // Going forward again returns to October and focuses its first available day.
    await tid(page, 'booking-month-next').click();
    await expect(tid(page, 'booking-month-label')).toHaveText('October 2026');
    await expect(tid(page, 'booking-day-2026-10-01')).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('Week view (English)', () => {
  test('switching shows the week label, free and taken cells', async ({ page, t }) => {
    await openBooking(page, t);
    await tid(page, 'booking-view-week').click();
    await expect(tid(page, 'booking-view-week')).toHaveAttribute('aria-selected', 'true');
    await expect(tid(page, 'booking-view-month')).toHaveAttribute('aria-selected', 'false');
    // The week of the focus day (Thu 1 Oct): Sunday 27 Sep .. Saturday 3 Oct.
    await expect(tid(page, 'booking-week-label')).toHaveText('27 Sep - 3 Oct');
    await expect(tid(page, 'booking-week-cell-2026-10-01-10:00')).toBeVisible();
    await expect(tid(page, 'booking-week-taken-2026-10-01-11:30')).toBeVisible();
    // Cells have no text, so they carry spoken labels: free = day + time, taken = day + time + "Taken".
    await expect(tid(page, 'booking-week-taken-2026-10-01-11:30')).toHaveAttribute('aria-label', /Taken$/);
    await expect(tid(page, 'booking-week-cell-2026-10-01-10:00')).toHaveAttribute('aria-label', /Thu, 1 October, 10:00 AM/);
    // Legend under the grid: free swatch + "Available", grey swatch + "Taken".
    await expect(tid(page, 'booking-week-legend')).toContainText(EN.available);
    await expect(tid(page, 'booking-week-legend')).toContainText(EN.taken);
    // A taken cell is not pressable: tapping it picks nothing.
    await tid(page, 'booking-week-taken-2026-10-01-11:30').click();
    await expect(tid(page, 'booking-selected')).toHaveCount(0);
    await expect(confirmBtn(page)).toHaveAttribute('aria-disabled', 'true');
  });

  test('selecting a week cell picks the slot, and Continue to payment creates the hold for it', async ({ page, mock, t }) => {
    await openBooking(page, t);
    await tid(page, 'booking-view-week').click();
    await tid(page, 'booking-week-cell-2026-10-01-10:00').click();
    await expect(tid(page, 'booking-week-cell-2026-10-01-10:00')).toHaveAttribute('aria-checked', 'true');
    await expect(confirmBtn(page)).not.toHaveAttribute('aria-disabled', 'true');
    await expect(confirmBtn(page)).toContainText(EN.continueToPayment);
    await confirmBtn(page).click();

    await expect(tid(page, 'booking-awaiting-payment')).toBeVisible();
    const posts = mock.callsTo('POST', '/api/bookings');
    expect(posts).toHaveLength(1);
    expect(posts[0].body.startsAt).toBe(BOOKING_SLOTS[0].startsAt);
  });

  test('the week arrows move by 7 days and are disabled at the edges', async ({ page, t }) => {
    await openBooking(page, t);
    await tid(page, 'booking-view-week').click();
    // Range is 2026-09-29 .. 2026-10-05. The first week (27 Sep - 3 Oct) is the first one that
    // holds the range, and the next week (4 Oct - 10 Oct) holds the last offered days.
    await tid(page, 'booking-week-next').click();
    await expect(tid(page, 'booking-week-label')).toHaveText('4 Oct - 10 Oct');
    await expect(tid(page, 'booking-week-cell-2026-10-04-10:00')).toBeVisible();
    await expect(tid(page, 'booking-week-next')).toHaveAttribute('aria-disabled', 'true');
    await tid(page, 'booking-week-prev').click();
    await expect(tid(page, 'booking-week-label')).toHaveText('27 Sep - 3 Oct');
    await expect(tid(page, 'booking-week-prev')).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('Day view (English)', () => {
  test('shows the day label and rows; next / prev move between days; a day without times is closed', async ({ page, t }) => {
    await openBooking(page, t);
    await tid(page, 'booking-view-day').click();
    await expect(tid(page, 'booking-view-day')).toHaveAttribute('aria-selected', 'true');
    await expect(tid(page, 'booking-dayview-label')).toContainText('1 October');
    await expect(freeRows(page)).toHaveCount(3);
    await expect(takenRows(page)).toHaveCount(2);

    // Friday 2 Oct: the clinic is closed, there is no row at all.
    await tid(page, 'booking-dayview-next').click();
    await expect(tid(page, 'booking-dayview-label')).toContainText('2 October');
    await expect(tid(page, 'booking-day-closed')).toHaveText(EN.closedDay);
    await expect(freeRows(page)).toHaveCount(0);

    await tid(page, 'booking-dayview-prev').click();
    await expect(tid(page, 'booking-dayview-label')).toContainText('1 October');
    await expect(tid(page, 'booking-day-closed')).toHaveCount(0);
    await expect(freeRows(page)).toHaveCount(3);
  });

  test('the day arrows are disabled at the range edges', async ({ page, t }) => {
    await openBooking(page, t);
    await tid(page, 'booking-view-day').click();
    // Walk forward to the last offered day, Mon 5 Oct (4 steps from the focus day, Thu 1 Oct).
    for (let i = 0; i < 4; i++) await tid(page, 'booking-dayview-next').click();
    await expect(tid(page, 'booking-dayview-label')).toContainText('5 October');
    await expect(tid(page, 'booking-dayview-next')).toHaveAttribute('aria-disabled', 'true');
    // Fully booked day: only taken rows.
    await expect(takenRows(page)).toHaveCount(2);
    await expect(freeRows(page)).toHaveCount(0);
    // Walk back to today (2026-09-29): the previous arrow is disabled there.
    for (let i = 0; i < 6; i++) await tid(page, 'booking-dayview-prev').click();
    await expect(tid(page, 'booking-dayview-label')).toContainText('29 September');
    await expect(tid(page, 'booking-dayview-prev')).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('switching views keeps the selected slot', () => {
  test('Month -> Week -> Day -> Month: the same slot stays picked and the summary stays', async ({ page, t }) => {
    await openBooking(page, t);
    await tid(page, 'booking-slot-10:30').click();
    await expect(tid(page, 'booking-selected')).toContainText('10:30');

    await tid(page, 'booking-view-week').click();
    await expect(tid(page, 'booking-week-cell-2026-10-01-10:30')).toHaveAttribute('aria-checked', 'true');
    await expect(tid(page, 'booking-selected')).toContainText('10:30');

    await tid(page, 'booking-view-day').click();
    await expect(tid(page, 'booking-slot-10:30')).toHaveAttribute('aria-checked', 'true');
    await expect(tid(page, 'booking-slot-10:30')).toContainText(EN.yourTime);

    await tid(page, 'booking-view-month').click();
    await expect(tid(page, 'booking-day-2026-10-01')).toHaveAttribute('aria-checked', 'true');
    await expect(tid(page, 'booking-slot-10:30')).toHaveAttribute('aria-checked', 'true');
    await expect(confirmBtn(page)).not.toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('Hebrew (RTL)', () => {
  test.use({ lang: 'he' });

  test('the page is RTL, the view tabs, legend and rows are Hebrew, times are 24 h', async ({ page }) => {
    await openBooking(page, tHe);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // Contract table and the locale file agree (a key missing in he/booking.json would throw here).
    expect(tHe('booking:taken')).toBe(HE.taken);
    expect(tHe('booking:closedDay')).toBe(HE.closedDay);

    await expect(tid(page, 'booking-view-month')).toContainText(HE.viewMonth);
    await expect(tid(page, 'booking-view-week')).toContainText(HE.viewWeek);
    await expect(tid(page, 'booking-view-day')).toContainText(HE.viewDay);
    await expect(tid(page, 'booking-month-label')).toContainText('2026');
    await expect(tid(page, 'booking-month-label')).toContainText('אוקטובר');
    await expect(tid(page, 'booking-legend')).toContainText(HE.legendAvailable);
    await expect(tid(page, 'booking-legend')).toContainText(HE.legendFull);
    await expect(tid(page, 'booking-month-prev')).toHaveAttribute('aria-label', HE.prevMonth);

    // Mirroring: in RTL Sunday is the right-most column, so Sun 4 Oct is to the RIGHT of Mon 5 Oct,
    // and the "previous month" arrow is to the right of the "next month" arrow.
    const box = async id => (await tid(page, id).boundingBox());
    const sun = await box('booking-day-2026-10-04');
    const mon = await box('booking-day-full-2026-10-05');
    expect(sun.x).toBeGreaterThan(mon.x);
    const prev = await box('booking-month-prev');
    const next = await box('booking-month-next');
    expect(prev.x).toBeGreaterThan(next.x);

    // Rows: free = "פנוי", taken = "תפוס", 24 h times without AM/PM.
    await expect(tid(page, 'booking-slot-10:00')).toContainText(HE.available);
    await expect(tid(page, 'booking-slot-10:00')).toContainText('10:00');
    await expect(tid(page, 'booking-slot-10:00')).not.toContainText(/AM|PM/);
    await expect(tid(page, 'booking-taken-11:30')).toContainText(HE.taken);
    await expect(tid(page, 'booking-taken-11:30')).not.toContainText(/AM|PM/);

    await tid(page, 'booking-slot-10:00').click();
    await expect(tid(page, 'booking-slot-10:00')).toContainText(HE.yourTime);
  });

  test('Week and Day views work in Hebrew: 24 h cells, closed-day text, next-day label', async ({ page }) => {
    await openBooking(page, tHe);
    await tid(page, 'booking-view-week').click();
    await expect(tid(page, 'booking-week-cell-2026-10-01-10:00')).toBeVisible();
    // The spoken labels use the Hebrew texts and 24 h times.
    await expect(tid(page, 'booking-week-cell-2026-10-01-10:00')).toHaveAttribute('aria-label', /10:00/);
    await expect(tid(page, 'booking-week-cell-2026-10-01-10:00')).not.toHaveAttribute('aria-label', /AM|PM/);
    await expect(tid(page, 'booking-week-taken-2026-10-01-11:30')).toBeVisible();
    await expect(tid(page, 'booking-week-taken-2026-10-01-11:30')).toHaveAttribute('aria-label', new RegExp(HE.taken + '$'));

    await tid(page, 'booking-view-day').click();
    await expect(tid(page, 'booking-dayview-next')).toHaveAttribute('aria-label', HE.nextDay);
    await tid(page, 'booking-dayview-next').click(); // Friday: closed
    await expect(tid(page, 'booking-day-closed')).toHaveText(HE.closedDay);
  });
});
