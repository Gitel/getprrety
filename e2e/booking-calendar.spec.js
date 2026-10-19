// Booking calendar views (plan AI/plans/booking-calendar-and-fix.md, contract
// AI/plans/booking-calendar-contract.md). Written TEST-FIRST: the Month / Week / Day views did not
// exist when this file was written, so it is red until the client build lands.
//
// Data (fixtures-data.js, page clock = Tue 2026-09-29, clinic 12:00, so "today" = 2026-09-29):
//   - FREE  (BOOKING_SLOTS): Thu 2026-10-01 10:00 / 10:30 / 11:00, Sun 2026-10-04 10:00 / 10:30.
//   - TAKEN (BOOKING_TAKEN): Thu 2026-10-01 11:30 / 12:00, Sun 2026-10-04 11:00,
//                            Mon 2026-10-05 10:00 / 10:30 (no free time -> a "fully booked" day).
// The screen opens in Month view with the first available day (2026-10-01) as the focus.
//
// ROUND 2 (2026-10-19, AI/plans/booking-calendar-contract.md 8.2): clicking a Month day cell opens a
// POP-UP (booking-popup) with that day's times; the times are NOT listed under the month grid any
// more. Picking a free time closes the pop-up and shows booking-selected. Week / Day keep their ids.
// A desktop block (1280 x 900) checks the 760 px column and the compact view toggle.
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
// Month view: opens the pop-up of a day (works for available days and fully booked days).
const openDay = async (page, date, full = false) => {
  await tid(page, full ? `booking-day-full-${date}` : `booking-day-${date}`).click();
  await expect(tid(page, 'booking-popup')).toBeVisible();
};
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

  test('no time list under the grid: times only show once a day is opened in the pop-up', async ({ page, t }) => {
    await openBooking(page, t);
    await expect(tid(page, 'booking-popup')).toHaveCount(0);
    await expect(freeRows(page)).toHaveCount(0);
    await expect(tid(page, 'booking-day-2026-10-01')).toBeVisible();
  });

  test('clicking a day opens the pop-up with free buttons and taken buttons (time only)', async ({ page, t }) => {
    await openBooking(page, t);
    await openDay(page, '2026-10-01');
    await expect(tid(page, 'booking-popup')).toHaveAttribute('role', 'dialog');
    await expect(tid(page, 'booking-popup')).toContainText('Thu, 1 October');
    await expect(freeRows(page)).toHaveCount(3);
    await expect(takenRows(page)).toHaveCount(2);
    for (const time of ['10:00', '10:30', '11:00']) {
      await expect(tid(page, `booking-slot-${time}`)).toHaveAttribute('aria-checked', 'false');
    }
    await expect(tid(page, 'booking-slot-10:00')).toContainText('10:00 AM');
    await expect(tid(page, 'booking-slot-10:00')).not.toContainText(EN.available);
    for (const time of ['11:30', '12:00']) {
      await expect(tid(page, `booking-taken-${time}`)).toHaveAttribute('aria-disabled', 'true');
      await expect(tid(page, `booking-taken-${time}`)).toHaveAttribute('aria-label', /Taken$/);
    }
    // Small legend at the bottom of the pop-up.
    await expect(tid(page, 'booking-popup')).toContainText(EN.available);
    await expect(tid(page, 'booking-popup')).toContainText(EN.taken);
  });

  test('a taken button cannot be selected: nothing is picked, the pop-up stays, confirm stays disabled', async ({ page, t }) => {
    await openBooking(page, t);
    await openDay(page, '2026-10-01');
    await tid(page, 'booking-taken-11:30').click();
    await expect(tid(page, 'booking-popup')).toBeVisible();
    await expect(tid(page, 'booking-selected')).toHaveCount(0);
    await expect(page.locator('[data-testid^="booking-slot-"][aria-checked="true"]')).toHaveCount(0);
    await tid(page, 'booking-popup-close').click();
    await expect(confirmBtn(page)).toHaveAttribute('aria-disabled', 'true');
  });

  test('picking a free time closes the pop-up, shows the summary and enables confirm; reopening shows it selected', async ({ page, t }) => {
    await openBooking(page, t);
    await openDay(page, '2026-10-01');
    await tid(page, 'booking-slot-10:30').click();
    await expect(tid(page, 'booking-popup')).toHaveCount(0);
    await expect(tid(page, 'booking-selected')).toContainText('10:30');
    await expect(confirmBtn(page)).not.toHaveAttribute('aria-disabled', 'true');
    await openDay(page, '2026-10-01');
    await expect(tid(page, 'booking-slot-10:30')).toHaveAttribute('aria-checked', 'true');
    await expect(tid(page, 'booking-slot-10:00')).toHaveAttribute('aria-checked', 'false');
  });

  test('the pop-up closes with the close button, the overlay and Escape; closing picks nothing', async ({ page, t }) => {
    await openBooking(page, t);
    await openDay(page, '2026-10-01');
    await expect(tid(page, 'booking-popup-close')).toHaveAttribute('aria-label', 'Close');
    await tid(page, 'booking-popup-close').click();
    await expect(tid(page, 'booking-popup')).toHaveCount(0);

    await openDay(page, '2026-10-01');
    await page.mouse.click(4, 4); // far from the centered card = the dark overlay
    await expect(tid(page, 'booking-popup')).toHaveCount(0);

    await openDay(page, '2026-10-01');
    await page.keyboard.press('Escape');
    await expect(tid(page, 'booking-popup')).toHaveCount(0);
    await expect(tid(page, 'booking-selected')).toHaveCount(0);
  });

  test('2026-10-05 is a fully booked cell: its pop-up shows only taken buttons and the full-day text', async ({ page, t }) => {
    await openBooking(page, t);
    await expect(tid(page, 'booking-day-full-2026-10-05')).toBeVisible();
    await openDay(page, '2026-10-05', true);
    await expect(takenRows(page)).toHaveCount(2);
    await expect(freeRows(page)).toHaveCount(0);
    await expect(tid(page, 'booking-popup')).toContainText('This day is fully booked.');
    await tid(page, 'booking-popup-close').click();
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
    await openDay(page, '2026-10-01');
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
    await openDay(page, '2026-10-01');
    await expect(tid(page, 'booking-slot-10:30')).toHaveAttribute('aria-checked', 'true');
    await tid(page, 'booking-popup-close').click();
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

    // Pop-up buttons: 24 h times without AM/PM; taken ones have the Hebrew "תפוס" in their spoken label.
    await openDay(page, '2026-10-01');
    await expect(tid(page, 'booking-slot-10:00')).toContainText('10:00');
    await expect(tid(page, 'booking-slot-10:00')).not.toContainText(/AM|PM/);
    await expect(tid(page, 'booking-taken-11:30')).toContainText('11:30');
    await expect(tid(page, 'booking-taken-11:30')).toHaveAttribute('aria-label', new RegExp(HE.taken + '$'));
    // RTL: the first time (10:00) is the right-most button of the grid.
    const b1 = await tid(page, 'booking-slot-10:00').boundingBox();
    const b2 = await tid(page, 'booking-slot-10:30').boundingBox();
    expect(b1.x).toBeGreaterThan(b2.x);

    await tid(page, 'booking-slot-10:00').click();
    await expect(tid(page, 'booking-popup')).toHaveCount(0);
    await expect(tid(page, 'booking-selected')).toContainText('10:00');
    // Day view: the picked row says "המועד שלכם".
    await tid(page, 'booking-view-day').click();
    await expect(tid(page, 'booking-slot-10:00')).toContainText(HE.yourTime);
    await expect(tid(page, 'booking-slot-10:30')).toContainText(HE.available);
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

// ---- Round 2: wide screens --------------------------------------------------------------------
// The default project viewport is a phone, so the desktop checks set their own size.
test.describe('desktop layout (1280 x 900)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the calendar card is a centered column of at most 760 px in every view', async ({ page, t }) => {
    await openBooking(page, t);
    for (const view of ['month', 'week', 'day']) {
      await tid(page, `booking-view-${view}`).click();
      const box = await tid(page, 'booking-calendar-card').boundingBox();
      expect(box.width).toBeLessThanOrEqual(760);
      expect(box.width).toBeGreaterThan(500); // it does use the column (not a tiny box)
      // Centered: about equal space left and right.
      expect(Math.abs(box.x - (1280 - box.x - box.width))).toBeLessThanOrEqual(24);
    }
  });

  test('the Month / Week / Day toggle is compact (not full width) and sits at the right end', async ({ page, t }) => {
    await openBooking(page, t);
    const sw = await tid(page, 'booking-view-switcher').boundingBox();
    expect(sw.width).toBeLessThan(300);
    const card = await tid(page, 'booking-calendar-card').boundingBox();
    // English: the toggle ends at the card's right edge.
    expect(sw.x + sw.width).toBeGreaterThan(card.x + card.width - 40);
  });

  test('Week view: hovering a free cell shows its time; a taken cell shows "Taken"; a pick fills the cell', async ({ page, t }) => {
    await openBooking(page, t);
    await tid(page, 'booking-view-week').click();
    const cell = tid(page, 'booking-week-cell-2026-10-01-10:00');
    await expect(cell).not.toContainText('10:00');
    await cell.hover();
    await expect(cell).toContainText('10:00 AM');
    await expect(tid(page, 'booking-week-taken-2026-10-01-11:30')).toContainText(EN.taken);
    await cell.click();
    await expect(cell).toHaveAttribute('aria-checked', 'true');
    await expect(cell).toContainText('10:00 AM'); // a selected cell always shows its time
  });

  test('Month view pop-up works on desktop and its card is at most 420 px wide', async ({ page, t }) => {
    await openBooking(page, t);
    await openDay(page, '2026-10-01');
    const box = await tid(page, 'booking-popup').boundingBox();
    expect(box.width).toBeLessThanOrEqual(420);
    await tid(page, 'booking-slot-11:00').click();
    await expect(tid(page, 'booking-selected')).toContainText('11:00');
  });

  test.describe('Hebrew', () => {
    test.use({ lang: 'he' });
    test('the toggle sits at the LEFT end and the week time column is on the right of the day cells', async ({ page }) => {
      await openBooking(page, tHe);
      const sw = await tid(page, 'booking-view-switcher').boundingBox();
      const card = await tid(page, 'booking-calendar-card').boundingBox();
      expect(sw.x).toBeLessThan(card.x + 40);
      await tid(page, 'booking-view-week').click();
      const timeCell = await tid(page, 'booking-week-time-10:00').boundingBox();
      const dayCell = await tid(page, 'booking-week-cell-2026-10-01-10:00').boundingBox();
      expect(timeCell.x).toBeGreaterThan(dayCell.x);
    });
  });
});
