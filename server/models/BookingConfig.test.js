// Schema-level tests for the BookingConfig singleton. No database.
const BookingConfig = require('./BookingConfig');

test('DEFAULTS: Sunday-Thursday 10:00-18:00, 30 min slots, no buffer, 12 h notice, 30 day window, Jerusalem', () => {
  expect(BookingConfig.DEFAULTS).toEqual({
    enabled: true,
    slotMinutes: 30,
    bufferMinutes: 0,
    leadHours: 12,
    horizonDays: 30,
    timeZone: 'Asia/Jerusalem',
    weekly: [0, 1, 2, 3, 4].map(day => ({ day, open: '10:00', close: '18:00' })),
  });
  expect(BookingConfig.SLOT_MINUTES).toEqual([15, 20, 30, 45, 60]);
});

test('a new document gets the defaults and the singleton key "main"', () => {
  const doc = new BookingConfig({});
  expect(doc.validateSync()).toBeUndefined();
  expect(doc.key).toBe('main');
  expect(doc.enabled).toBe(true);
  expect(doc.slotMinutes).toBe(30);
  expect(doc.bufferMinutes).toBe(0);
  expect(doc.leadHours).toBe(12);
  expect(doc.horizonDays).toBe(30);
  expect(doc.timeZone).toBe('Asia/Jerusalem');
});

test('the key is unique (that is what makes it a singleton)', () => {
  expect(BookingConfig.schema.path('key').options.unique).toBe(true);
});

describe('numeric limits', () => {
  const errorsFor = patch => (new BookingConfig(patch).validateSync() || { errors: {} }).errors;

  test.each([15, 20, 30, 45, 60])('slotMinutes %i is allowed', v => expect(errorsFor({ slotMinutes: v }).slotMinutes).toBeUndefined());
  test.each([0, 10, 25, 90])('slotMinutes %i is rejected', v => expect(errorsFor({ slotMinutes: v }).slotMinutes).toBeDefined());

  test.each([0, 60])('bufferMinutes %i is allowed', v => expect(errorsFor({ bufferMinutes: v }).bufferMinutes).toBeUndefined());
  test.each([-1, 61])('bufferMinutes %i is rejected', v => expect(errorsFor({ bufferMinutes: v }).bufferMinutes).toBeDefined());

  test.each([0, 168])('leadHours %i is allowed', v => expect(errorsFor({ leadHours: v }).leadHours).toBeUndefined());
  test.each([-1, 169])('leadHours %i is rejected', v => expect(errorsFor({ leadHours: v }).leadHours).toBeDefined());

  test.each([1, 30])('horizonDays %i is allowed', v => expect(errorsFor({ horizonDays: v }).horizonDays).toBeUndefined());
  test.each([0, 31])('horizonDays %i is rejected', v => expect(errorsFor({ horizonDays: v }).horizonDays).toBeDefined());
});

describe('weekly', () => {
  test('0 (Sunday) to 6 (Saturday) are valid weekdays and entries carry no _id', () => {
    const doc = new BookingConfig({ weekly: [{ day: 0, open: '10:00', close: '18:00' }, { day: 6, open: '09:00', close: '12:00' }] });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.toObject().weekly).toEqual([{ day: 0, open: '10:00', close: '18:00' }, { day: 6, open: '09:00', close: '12:00' }]);
  });

  test.each([-1, 7])('weekday %i is rejected', day => {
    const err = new BookingConfig({ weekly: [{ day, open: '10:00', close: '18:00' }] }).validateSync();
    expect(err).toBeDefined();
  });
});
