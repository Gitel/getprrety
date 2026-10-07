const { isDuplicateEmail, isDuplicateStartsAt } = require('./duplicateKey');

const duplicateOn = index => Object.assign(
  new Error(`E11000 duplicate key error collection: getprrety.users index: ${index}_1 dup key`),
  { code: 11000, keyPattern: { [index]: 1 } },
);

test('a duplicate on the email index is an email conflict', () => {
  expect(isDuplicateEmail(duplicateOn('email'))).toBe(true);
});

test('a duplicate on any other unique index is NOT an email conflict', () => {
  // This is the case that took signup down: a googleId_1 collision was reported to users
  // as "Email already registered" on an address they had never used.
  expect(isDuplicateEmail(duplicateOn('googleId'))).toBe(false);
});

test('falls back to the index name in the message when the driver omits keyPattern', () => {
  const withoutKeyPattern = message => Object.assign(new Error(message), { code: 11000 });

  expect(isDuplicateEmail(withoutKeyPattern(
    'E11000 duplicate key error collection: getprrety.users index: email_1 dup key: { email: "a@b.c" }',
  ))).toBe(true);
  expect(isDuplicateEmail(withoutKeyPattern(
    'E11000 duplicate key error collection: getprrety.users index: googleId_1 dup key: { googleId: null }',
  ))).toBe(false);
});

test('a duplicate naming no index at all is not assumed to be email', () => {
  expect(isDuplicateEmail(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }))).toBe(false);
});

test('errors that are not duplicate-key errors are never email conflicts', () => {
  expect(isDuplicateEmail(new Error('boom'))).toBe(false);
  expect(isDuplicateEmail(Object.assign(new Error('write conflict'), { code: 112 }))).toBe(false);
  expect(isDuplicateEmail(undefined)).toBe(false);
});

// A second confirmed booking for the same slot trips the unique partial index on startsAt.
describe('isDuplicateStartsAt', () => {
  const dupOn = index => Object.assign(
    new Error(`E11000 duplicate key error collection: getprrety.bookings index: ${index}_1 dup key`),
    { code: 11000, keyPattern: { [index]: 1 } },
  );

  test('a duplicate on the startsAt index is a slot conflict', () => {
    expect(isDuplicateStartsAt(dupOn('startsAt'))).toBe(true);
  });

  test('a duplicate on any other index is NOT a slot conflict', () => {
    expect(isDuplicateStartsAt(dupOn('email'))).toBe(false);
  });

  test('falls back to the index name in the message when keyPattern is missing', () => {
    const withoutKeyPattern = message => Object.assign(new Error(message), { code: 11000 });
    expect(isDuplicateStartsAt(withoutKeyPattern('E11000 duplicate key error collection: getprrety.bookings index: startsAt_1 dup key: { startsAt: new Date(1) }'))).toBe(true);
    expect(isDuplicateStartsAt(withoutKeyPattern('E11000 duplicate key error collection: getprrety.users index: email_1 dup key'))).toBe(false);
    expect(isDuplicateStartsAt(withoutKeyPattern('E11000 duplicate key'))).toBe(false);
  });

  test('errors that are not duplicate-key errors are never slot conflicts', () => {
    expect(isDuplicateStartsAt(new Error('boom'))).toBe(false);
    expect(isDuplicateStartsAt(Object.assign(new Error('write conflict'), { code: 112 }))).toBe(false);
    expect(isDuplicateStartsAt(undefined)).toBe(false);
  });
});
