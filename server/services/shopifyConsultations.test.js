// Tests for shopifyConsultations.js with an in-memory fake model, fake calendar and fake clock
// (no database, no network). The fake understands just the query shapes the service uses.
const svc = require('./shopifyConsultations');

const NOW = new Date('2026-10-19T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

// ---- fake model --------------------------------------------------------------------------------
function makeOrderModel(rows = []) {
  return {
    rows,
    updateOne: jest.fn(async (filter, update, opts = {}) => {
      const row = rows.find(r => r.orderId === filter.orderId);
      if (row) {
        if (update.$set) Object.assign(row, update.$set);
        return { upsertedCount: 0, modifiedCount: update.$set ? 1 : 0 };
      }
      if (!opts.upsert) return { upsertedCount: 0, modifiedCount: 0 };
      rows.push({ appointment: null, lastCheckedAt: null, ...update.$setOnInsert });
      return { upsertedCount: 1, modifiedCount: 0 };
    }),
  };
}

const shopifyOrder = (extra = {}) => ({
  id: 5001, name: '#1042', email: ' Ada@Example.COM ', processed_at: '2026-10-19T09:30:00Z',
  total_price: '350.00', currency: 'ILS', customer: { first_name: 'Ada' }, ...extra,
});

describe('recordOrder', () => {
  test('stores only the needed fields (no name, no payload), email lowercased', async () => {
    const Order = makeOrderModel();
    const out = await svc.recordOrder(shopifyOrder(), { Order, now: () => NOW });
    expect(out).toEqual({ ok: true, result: 'shopify_consultation_recorded' });
    expect(Order.rows).toEqual([{
      orderId: '5001', orderName: '#1042', email: 'ada@example.com',
      paidAt: new Date('2026-10-19T09:30:00Z'), amount: 350, currency: 'ILS',
      appointment: null, lastCheckedAt: null,
    }]);
  });

  test('a re-delivery of the same order changes nothing', async () => {
    const Order = makeOrderModel();
    await svc.recordOrder(shopifyOrder(), { Order, now: () => NOW });
    const again = await svc.recordOrder(shopifyOrder({ email: 'other@x.co' }), { Order, now: () => NOW });
    expect(again.result).toBe('already_recorded');
    expect(Order.rows).toHaveLength(1);
    expect(Order.rows[0].email).toBe('ada@example.com');
  });

  test('a duplicate-key race counts as already recorded; other errors are thrown', async () => {
    const Order = { updateOne: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 })) };
    expect((await svc.recordOrder(shopifyOrder(), { Order })).result).toBe('already_recorded');
    Order.updateOne.mockRejectedValue(new Error('db down'));
    await expect(svc.recordOrder(shopifyOrder(), { Order })).rejects.toThrow('db down');
  });

  test.each([undefined, '', 'not-an-email', 42])('email %p -> no_email, nothing stored', async email => {
    const Order = makeOrderModel();
    expect(await svc.recordOrder(shopifyOrder({ email }), { Order })).toEqual({ ok: true, result: 'no_email' });
    expect(Order.updateOne).not.toHaveBeenCalled();
  });

  test('missing processed_at / price / currency -> our clock and nulls', async () => {
    const Order = makeOrderModel();
    await svc.recordOrder(shopifyOrder({ processed_at: 'garbage', total_price: undefined, currency: undefined, name: undefined }), { Order, now: () => NOW });
    expect(Order.rows[0]).toMatchObject({ paidAt: NOW, amount: null, currency: null, orderName: '' });
  });
});
