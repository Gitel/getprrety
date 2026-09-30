// The module reads process.env at import time, so each case needs a fresh registry.
function loadBooking(value) {
  jest.resetModules();
  if (value === undefined) delete process.env.VITE_BOOKING_URL;
  else process.env.VITE_BOOKING_URL = value;
  return require('./booking');
}

afterEach(() => {
  delete process.env.VITE_BOOKING_URL;
});

test('not ready when the variable is unset', () => {
  const { BOOKING_URL, BOOKING_READY } = loadBooking(undefined);
  expect(BOOKING_URL).toBeUndefined();
  expect(BOOKING_READY).toBe(false);
});

test('not ready when empty', () => {
  expect(loadBooking('').BOOKING_READY).toBe(false);
});

test('not ready when only whitespace', () => {
  expect(loadBooking('   ').BOOKING_READY).toBe(false);
});

test('not ready for http:// (https only)', () => {
  expect(loadBooking('http://clinic.test/book').BOOKING_READY).toBe(false);
});

test('not ready for a javascript: URL', () => {
  expect(loadBooking('javascript:alert(1)').BOOKING_READY).toBe(false);
});

test('not ready for a malformed value', () => {
  expect(loadBooking('not a url').BOOKING_READY).toBe(false);
  expect(loadBooking('https://').BOOKING_READY).toBe(false);
});

test('ready for a valid https URL', () => {
  const { BOOKING_URL, BOOKING_READY } = loadBooking('https://clinic.test/book?x=1');
  expect(BOOKING_URL).toBe('https://clinic.test/book?x=1');
  expect(BOOKING_READY).toBe(true);
});

test('ready for a valid https URL with surrounding whitespace', () => {
  expect(loadBooking('  https://clinic.test/book \n').BOOKING_READY).toBe(true);
});
