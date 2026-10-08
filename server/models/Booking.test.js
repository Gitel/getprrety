// Schema-level tests for the Booking model. No database: validateSync() and schema.indexes() only.
const mongoose = require('mongoose');
const Booking = require('./Booking');

const valid = () => ({
  userId: new mongoose.Types.ObjectId(),
  startsAt: new Date('2026-10-08T07:00:00Z'),
  endsAt: new Date('2026-10-08T07:30:00Z'),
});

test('a minimal booking is valid and gets the documented defaults', () => {
  const doc = new Booking(valid());
  expect(doc.validateSync()).toBeUndefined();
  expect(doc.status).toBe('confirmed');
  expect(doc.calendarEventId).toBeNull();
  expect(doc.calendarId).toBe('');
  expect(doc.note).toBe('');
  expect(doc.cancelledAt).toBeNull();
  expect(doc.cancelledByAdminEmail).toBeNull();
});

test('payment is the reserved seam: status none, everything else null, no sub-document _id', () => {
  const payment = new Booking(valid()).toObject().payment;
  expect(payment).toEqual({ status: 'none', amount: null, currency: null, providerRef: null });
});

test('static lists: STATUSES and NOTE_MAX', () => {
  expect(Booking.STATUSES).toEqual(['confirmed', 'cancelled']);
  expect(Booking.NOTE_MAX).toBe(300);
});

test('userId, startsAt and endsAt are required', () => {
  const errors = new Booking({}).validateSync().errors;
  expect(errors.userId).toBeDefined();
  expect(errors.startsAt).toBeDefined();
  expect(errors.endsAt).toBeDefined();
});

test('userId references the User model', () => {
  expect(Booking.schema.path('userId').options.ref).toBe('User');
});

test.each(['confirmed', 'cancelled'])('status %p is accepted', status => {
  expect(new Booking({ ...valid(), status }).validateSync()).toBeUndefined();
});

test.each(['pending_payment', 'paid', 'CONFIRMED', ''])('status %p is rejected', status => {
  expect(new Booking({ ...valid(), status }).validateSync().errors.status).toBeDefined();
});

describe('note', () => {
  test('is trimmed', () => {
    expect(new Booking({ ...valid(), note: '  hello  ' }).note).toBe('hello');
  });
  test('300 characters is the maximum', () => {
    expect(new Booking({ ...valid(), note: 'x'.repeat(300) }).validateSync()).toBeUndefined();
    expect(new Booking({ ...valid(), note: 'x'.repeat(301) }).validateSync().errors.note).toBeDefined();
  });
});

test('cancelledByAdminEmail is lowercased and trimmed', () => {
  expect(new Booking({ ...valid(), cancelledByAdminEmail: '  Admin@Example.COM ' }).cancelledByAdminEmail).toBe('admin@example.com');
});

test('timestamps are on (createdAt / updatedAt)', () => {
  expect(Booking.schema.path('createdAt')).toBeDefined();
  expect(Booking.schema.path('updatedAt')).toBeDefined();
});

describe('indexes', () => {
  const indexes = Booking.schema.indexes();
  const find = keys => indexes.find(([fields]) => JSON.stringify(fields) === JSON.stringify(keys));

  test('{userId:1, startsAt:-1} serves "my bookings"', () => {
    expect(find({ userId: 1, startsAt: -1 })).toBeDefined();
  });

  test('{startsAt:1} is UNIQUE but only for confirmed bookings (the double-booking guard)', () => {
    const entry = find({ startsAt: 1 });
    expect(entry).toBeDefined();
    expect(entry[1].unique).toBe(true);
    expect(entry[1].partialFilterExpression).toEqual({ status: 'confirmed' });
  });
});
