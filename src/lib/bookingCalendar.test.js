import {
  CLINIC_TIME_ZONE, clinicToday, addDays, buildDayIndex, dayStatus, monthGrid, weekDates,
  weekTimes, navRange, firstAvailableDate, clampDate,
} from './bookingCalendar';

// Minimal slot object; startsAt only needs to sort the same way as the time.
const slot = (date, time) => ({ startsAt: `${date}T${time}:00Z`, endsAt: 'x', date, time });

describe('monthGrid', () => {
  const flat = (w) => w.flat().filter(Boolean);
  test('month starting on Sunday has no leading padding (Feb 2026: 28 days = 4 full weeks)', () => {
    const g = monthGrid(2026, 2);
    expect(g).toHaveLength(4);
    expect(g[0][0]).toBe('2026-02-01');
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(flat(g)).toHaveLength(28);
  });
  test('month starting on Saturday pads six cells (Aug 2026)', () => {
    const g = monthGrid(2026, 8);
    expect(g[0].slice(0, 6)).toEqual(Array(6).fill(null));
    expect(g[0][6]).toBe('2026-08-01');
    expect(flat(g)).toHaveLength(31);
    expect(g).toHaveLength(6);
  });
  test('October 2026 starts on Thursday, ends on Saturday', () => {
    const oct = monthGrid(2026, 10);
    expect(oct[0].indexOf('2026-10-01')).toBe(4);
    expect(flat(oct)).toHaveLength(31);
    expect(oct[oct.length - 1][6]).toBe('2026-10-31');
  });
  test('month lengths: leap February 29, plain February 28, April 30', () => {
    expect(flat(monthGrid(2028, 2))).toHaveLength(29);
    expect(flat(monthGrid(2027, 2))).toHaveLength(28);
    expect(flat(monthGrid(2026, 4))).toHaveLength(30);
  });
});

describe('weekDates / addDays', () => {
  test('week across a month boundary (Sun 27 Sep .. Sat 3 Oct 2026)', () => {
    expect(weekDates('2026-10-01')).toEqual([
      '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03',
    ]);
  });
  test('week across a year boundary', () => {
    const w = weekDates('2026-12-31');
    expect(w[0]).toBe('2026-12-27');
    expect(w[6]).toBe('2027-01-02');
  });
  test('a Sunday is the first day of its own week', () => {
    expect(weekDates('2026-10-04')[0]).toBe('2026-10-04');
  });
  test('addDays crosses months, years, leap days and DST changes by calendar day', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-26', 1)).toBe('2026-03-27'); // Israel DST starts 27 Mar 2026
    expect(addDays('2026-03-27', 1)).toBe('2026-03-28');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26'); // Israel DST ends 25 Oct 2026
    expect(addDays('2026-10-19', 30)).toBe('2026-11-18');
  });
});

describe('index helpers', () => {
  const slots = [slot('2026-10-01', '10:30'), slot('2026-10-01', '10:00')];
  const taken = [slot('2026-10-01', '11:00'), slot('2026-10-05', '10:00'), slot('2026-10-01', '10:15')];
  const index = buildDayIndex(slots, taken);

  test('buildDayIndex merges, flags and sorts by startsAt', () => {
    expect(index.get('2026-10-01').map((r) => `${r.time}${r.taken ? 'T' : ''}`))
      .toEqual(['10:00', '10:15T', '10:30', '11:00T']);
    expect(buildDayIndex().size).toBe(0);
  });
  test('dayStatus', () => {
    expect(dayStatus(index, '2026-10-01')).toBe('available');
    expect(dayStatus(index, '2026-10-05')).toBe('full');
    expect(dayStatus(index, '2026-10-06')).toBe('none');
  });
  test('weekTimes is sorted and unique', () => {
    expect(weekTimes(index, weekDates('2026-10-01'))).toEqual(['10:00', '10:15', '10:30', '11:00']);
    expect(weekTimes(index, ['2026-10-09'])).toEqual([]);
  });
  test('navRange / clampDate', () => {
    const r = navRange(index, '2026-09-29');
    expect(r).toEqual({ min: '2026-09-29', max: '2026-10-05' });
    expect(navRange(new Map(), '2026-09-29')).toEqual({ min: '2026-09-29', max: '2026-09-29' });
    // A phone clock that is ahead of the server: the first offered day still counts.
    expect(navRange(index, '2026-10-03')).toEqual({ min: '2026-10-01', max: '2026-10-05' });
    expect(clampDate('2026-09-01', r)).toBe('2026-09-29');
    expect(clampDate('2026-12-01', r)).toBe('2026-10-05');
    expect(clampDate('2026-10-02', r)).toBe('2026-10-02');
  });
  test('firstAvailableDate prefers free, then any, then null', () => {
    expect(firstAvailableDate(index)).toBe('2026-10-01');
    expect(firstAvailableDate(buildDayIndex([], [slot('2026-10-05', '10:00'), slot('2026-10-04', '10:00')])))
      .toBe('2026-10-04');
    expect(firstAvailableDate(new Map())).toBeNull();
    // the earliest date is full but a later one is available -> the later one
    expect(firstAvailableDate(buildDayIndex([slot('2026-10-06', '10:00')], [slot('2026-10-05', '10:00')])))
      .toBe('2026-10-06');
  });
});

describe('clinicToday', () => {
  test('uses the clinic zone, not the machine zone (around clinic midnight)', () => {
    expect(CLINIC_TIME_ZONE).toBe('Asia/Jerusalem');
    // Winter (UTC+2): 21:59Z is 23:59 clinic time, 22:00Z is already the next day.
    expect(clinicToday(new Date('2026-01-10T21:59:00Z'))).toBe('2026-01-10');
    expect(clinicToday(new Date('2026-01-10T22:00:00Z'))).toBe('2026-01-11');
    // Summer (UTC+3): 20:59Z is 23:59, 21:00Z is midnight.
    expect(clinicToday(new Date('2026-07-10T20:59:00Z'))).toBe('2026-07-10');
    expect(clinicToday(new Date('2026-07-10T21:00:00Z'))).toBe('2026-07-11');
    expect(clinicToday(new Date('2026-09-29T09:00:00Z'))).toBe('2026-09-29');
  });
});
