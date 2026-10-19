// Pure helpers of the booking client (src/lib/bookingApi.js). Written before the module exists.
// Contract: AI/plans/in-app-booking-contract.md section 8.
import { weekdayNames, monthNames } from './formatting';
import { MAX_NOTE_LENGTH, formatSlotDay, formatBookingWhen, clinicHHMM } from './bookingApi';

test('MAX_NOTE_LENGTH matches the server limit', () => {
  expect(MAX_NOTE_LENGTH).toBe(300);
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

describe('clinicHHMM', () => {
  test('uses clinic time (summer UTC+3, winter UTC+2), not the device zone', () => {
    expect(clinicHHMM('2026-07-01T07:05:00Z')).toBe('10:05');
    expect(clinicHHMM('2026-01-01T07:05:00Z')).toBe('09:05');
    expect(clinicHHMM('2026-07-01T21:30:00Z')).toBe('00:30'); // midnight shows 00, not 24
  });
  test('invalid input gives an empty string', () => {
    expect(clinicHHMM('nope')).toBe('');
    expect(clinicHHMM(null)).toBe('');
  });
});
