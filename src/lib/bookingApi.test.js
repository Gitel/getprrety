// Pure helpers of the booking client (src/lib/bookingApi.js). Written before the module exists.
// Contract: AI/plans/in-app-booking-contract.md section 8.
import { weekdayNames, monthNames } from './formatting';
import { MAX_NOTE_LENGTH, groupSlotsByDate, formatSlotDay, formatBookingWhen } from './bookingApi';

// Same shape the server sends: clinic-local `date` / `time` next to the UTC instants.
const slot = (date, time) => ({ startsAt: `${date}T${time}:00.000Z`, endsAt: `${date}T${time}:30.000Z`, date, time });

test('MAX_NOTE_LENGTH matches the server limit', () => {
  expect(MAX_NOTE_LENGTH).toBe(300);
});

describe('groupSlotsByDate', () => {
  test('groups by date, keeping the input order of days and of slots', () => {
    const a = slot('2026-10-01', '10:00');
    const b = slot('2026-10-01', '10:30');
    const c = slot('2026-10-04', '10:00');
    expect(groupSlotsByDate([a, b, c])).toEqual([
      { date: '2026-10-01', slots: [a, b] },
      { date: '2026-10-04', slots: [c] },
    ]);
  });

  test('an empty list gives no groups', () => {
    expect(groupSlotsByDate([])).toEqual([]);
  });

  test('does not mutate its input', () => {
    const input = [slot('2026-10-01', '10:00'), slot('2026-10-04', '10:00')];
    const copy = JSON.parse(JSON.stringify(input));
    groupSlotsByDate(input);
    expect(input).toEqual(copy);
  });
});

describe('formatSlotDay', () => {
  test('English: weekday, day and month name', () => {
    expect(formatSlotDay('2026-10-01', 'en')).toBe('Thu, 1 October');
    expect(formatSlotDay('2026-10-04', 'en')).toBe('Sun, 4 October');
    expect(formatSlotDay('2026-12-31', 'en')).toBe('Thu, 31 December'); // no timezone drift at month ends
  });

  test('Hebrew: built from the Hebrew weekday and month names', () => {
    const out = formatSlotDay('2026-10-01', 'he');
    expect(out).toContain(weekdayNames('he')[4]); // Thursday
    expect(out).toContain(monthNames('he')[9]);   // October
    expect(out).toContain('1');
  });
});

describe('formatBookingWhen', () => {
  const booking = { date: '2026-10-01', time: '10:00' };

  test('English: day, then a 12 h time', () => {
    expect(formatBookingWhen(booking, 'en')).toBe('Thu, 1 October, 10:00 AM');
    expect(formatBookingWhen({ date: '2026-10-04', time: '17:30' }, 'en')).toBe('Sun, 4 October, 5:30 PM');
  });

  test('Hebrew: day, then a 24 h time', () => {
    const out = formatBookingWhen(booking, 'he');
    expect(out).toBe(`${formatSlotDay('2026-10-01', 'he')}, 10:00`);
    expect(out).not.toMatch(/AM|PM/);
  });
});
