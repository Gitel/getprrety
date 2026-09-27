import { dayNumber } from './scoreReading';

describe('dayNumber - "Day N" on the score section', () => {
  test('the first reading is Day 1', () => {
    const first = new Date(2026, 8, 20, 9, 0);
    expect(dayNumber(first, first)).toBe(1);
  });

  test('counts calendar days, not 24-hour periods', () => {
    const first = new Date(2026, 8, 20, 23, 30);
    expect(dayNumber(first, new Date(2026, 8, 21, 0, 15))).toBe(2); // 45 minutes later, next day
    expect(dayNumber(first, new Date(2026, 8, 27, 10, 0))).toBe(8);
  });

  test('accepts ISO strings from the server', () => {
    const first = new Date(2026, 8, 20, 12).toISOString();
    const reading = new Date(2026, 8, 22, 12).toISOString();
    expect(dayNumber(first, reading)).toBe(3);
  });

  test('an unsaved reading counts up to now', () => {
    expect(dayNumber(new Date(2026, 8, 20, 12), undefined, new Date(2026, 8, 23, 8))).toBe(4);
  });

  test('no first reading (anonymous or not saved yet) or a bad date -> Day 1', () => {
    expect(dayNumber(undefined, new Date())).toBe(1);
    expect(dayNumber(null, null)).toBe(1);
    expect(dayNumber('not a date', new Date())).toBe(1);
  });

  test('never below Day 1, even if the dates arrive out of order', () => {
    expect(dayNumber(new Date(2026, 8, 25), new Date(2026, 8, 20))).toBe(1);
  });
});
