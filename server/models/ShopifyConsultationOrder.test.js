// Schema-level tests for the ShopifyConsultationOrder model. No database: validateSync() and
// schema.indexes() only.
const Order = require('./ShopifyConsultationOrder');

const valid = () => ({ orderId: '777', email: 'A@B.co ', paidAt: new Date('2026-10-19T08:00:00Z') });

test('a minimal order is valid; email is lowercased and trimmed; documented defaults', () => {
  const doc = new Order(valid());
  expect(doc.validateSync()).toBeUndefined();
  expect(doc.email).toBe('a@b.co');
  expect(doc.orderName).toBe('');
  expect(doc.appointment).toBeNull();
  expect(doc.lastCheckedAt).toBeNull();
});

test('orderId, email and paidAt are required', () => {
  for (const key of ['orderId', 'email', 'paidAt']) {
    const fields = valid();
    delete fields[key];
    expect(new Order(fields).validateSync().errors[key]).toBeDefined();
  }
});

test('an appointment needs eventId, startsAt, endsAt and matchedAt', () => {
  const doc = new Order({ ...valid(), appointment: { eventId: 'e1' } });
  const errors = doc.validateSync().errors;
  expect(Object.keys(errors)).toEqual(expect.arrayContaining(['appointment.startsAt', 'appointment.endsAt', 'appointment.matchedAt']));
});

test('orderId is unique; email+paidAt and the sweep index exist', () => {
  expect(Order.schema.path('orderId').options.unique).toBe(true);
  const keys = Order.schema.indexes().map(([k]) => JSON.stringify(k));
  expect(keys).toEqual(expect.arrayContaining([
    JSON.stringify({ email: 1, paidAt: -1 }),
    JSON.stringify({ paidAt: 1, lastCheckedAt: 1 }),
  ]));
});
