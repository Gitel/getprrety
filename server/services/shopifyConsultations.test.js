// Tests for shopifyConsultations.js with an in-memory fake model, fake calendar and fake clock
// (no database, no network). The fake understands just the query shapes the service uses.
const svc = require('./shopifyConsultations');

const NOW = new Date('2026-10-19T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

// ---- fake model --------------------------------------------------------------------------------
const getPath = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const norm = v => (v === undefined ? null : v);
const same = (a, b) => (a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : String(a) === String(b));

// Just the operators the service uses: equality, null, $gt, $ne, $in, $or.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some(f => matches(doc, f));
    const value = norm(getPath(doc, key));
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$gt') return value !== null && value > arg;
        if (op === '$ne') return !same(value, arg);
        if (op === '$in') return arg.some(a => same(value, a));
        throw new Error(`fake: operator ${op}`);
      });
    }
    return cond === null ? value === null : same(value, cond);
  });
}

// Deep copy that keeps Dates (what .lean() hands back: plain objects, not the stored ones).
const copy = v => (v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(copy)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v);

// A query object that works with `await` and .sort() / .limit() / .select() / .lean().
function query(produce) {
  let sortSpec = null;
  let max = Infinity;
  return {
    sort(spec) { sortSpec = spec; return this; },
    limit(n) { max = n; return this; },
    select() { return this; },
    lean() { return this; },
    then(res, rej) {
      return Promise.resolve().then(() => {
        let out = produce();
        if (sortSpec) {
          const [[field, dir]] = Object.entries(sortSpec);
          // Mongo sorts null before any date in ascending order.
          const key = r => (r[field] == null ? -Infinity : new Date(r[field]).getTime());
          out = out.slice().sort((a, b) => (key(a) - key(b)) * dir);
        }
        return out.slice(0, max).map(copy);
      }).then(res, rej);
    },
  };
}

function makeOrderModel(rows = []) {
  return {
    rows,
    find: jest.fn(filter => query(() => rows.filter(r => matches(r, filter)))),
    // Returns a real promise (the service calls .catch() on one of them).
    updateOne: jest.fn(async (filter, update, opts = {}) => {
      const row = rows.find(r => matches(r, filter));
      if (row) {
        if (update.$set) Object.assign(row, update.$set);
        return { upsertedCount: 0, modifiedCount: update.$set ? 1 : 0 };
      }
      if (!opts.upsert) return { upsertedCount: 0, modifiedCount: 0 };
      rows.push({ appointment: null, lastCheckedAt: null, ...update.$setOnInsert });
      return { upsertedCount: 1, modifiedCount: 0 };
    }),
    deleteMany: jest.fn(async filter => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i], filter)) rows.splice(i, 1);
      return { deletedCount: before - rows.length };
    }),
  };
}

// A stored order row (as recordOrder writes it), paid one day before NOW.
const row = (orderId, extra = {}) => ({
  orderId, orderName: `#${orderId}`, email: 'ada@x.co', paidAt: new Date(NOW.getTime() - DAY),
  amount: 350, currency: 'ILS', appointment: null, lastCheckedAt: null, ...extra,
});
// An appointment `days` after NOW lasting `minutes`.
const at = (days, minutes = 30) => {
  const startsAt = new Date(NOW.getTime() + days * DAY);
  return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60000) };
};

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

describe('matchAppointments', () => {
  const calendarWith = (byEmail = {}) => ({
    findAttendeeEvents: jest.fn(async ({ email }) => (byEmail[email] || []).slice()),
  });
  let errorSpy;
  beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => errorSpy.mockRestore());

  test('an unmatched order gets the earliest event; the search starts at payment, 60 days ahead', async () => {
    const Order = makeOrderModel([row('1')]);
    const calendar = calendarWith({ 'ada@x.co': [{ eventId: 'e1', ...at(3) }, { eventId: 'e2', ...at(9) }] });
    const out = await svc.matchAppointments({ Order, calendar, now: () => NOW });
    expect(out).toEqual({ checked: 1, matched: 1, failed: 0 });
    expect(calendar.findAttendeeEvents).toHaveBeenCalledWith({
      email: 'ada@x.co', timeMin: Order.rows[0].paidAt, timeMax: new Date(Order.rows[0].paidAt.getTime() + 60 * DAY),
    });
    expect(Order.rows[0].appointment).toEqual({ eventId: 'e1', ...at(3), matchedAt: NOW });
    expect(Order.rows[0].lastCheckedAt).toEqual(NOW);
  });

  test('no event -> stays unmatched but is marked checked', async () => {
    const Order = makeOrderModel([row('1')]);
    await svc.matchAppointments({ Order, calendar: calendarWith(), now: () => NOW });
    expect(Order.rows[0]).toMatchObject({ appointment: null, lastCheckedAt: NOW });
  });

  test('a future match is re-checked: rescheduled -> new time, cancelled (gone) -> unmatched', async () => {
    const Order = makeOrderModel([row('1', { appointment: { eventId: 'e1', ...at(3), matchedAt: NOW } })]);
    await svc.matchAppointments({ Order, calendar: calendarWith({ 'ada@x.co': [{ eventId: 'e1', ...at(5) }] }), now: () => NOW });
    expect(Order.rows[0].appointment.startsAt).toEqual(at(5).startsAt);
    await svc.matchAppointments({ Order, calendar: calendarWith(), now: () => NOW });
    expect(Order.rows[0].appointment).toBeNull();
  });

  test('ended appointments and orders older than 60 days are not checked again', async () => {
    const Order = makeOrderModel([
      row('ended', { appointment: { eventId: 'e0', ...at(-2), matchedAt: NOW } }),
      row('old', { paidAt: new Date(NOW.getTime() - 61 * DAY) }),
    ]);
    const calendar = calendarWith();
    expect(await svc.matchAppointments({ Order, calendar, now: () => NOW })).toEqual({ checked: 0, matched: 0, failed: 0 });
    expect(calendar.findAttendeeEvents).not.toHaveBeenCalled();
  });

  test('two orders of the same customer take two different events', async () => {
    const Order = makeOrderModel([row('1'), row('2', { paidAt: NOW })]);
    const calendar = calendarWith({ 'ada@x.co': [{ eventId: 'e1', ...at(3) }, { eventId: 'e2', ...at(9) }] });
    await svc.matchAppointments({ Order, calendar, now: () => NOW });
    expect(Order.rows.map(r => r.appointment && r.appointment.eventId).sort()).toEqual(['e1', 'e2']);
  });

  test('a calendar error is logged with the order id only and does not stop the others', async () => {
    const Order = makeOrderModel([row('1', { email: 'bad@x.co' }), row('2')]);
    const calendar = calendarWith({ 'ada@x.co': [{ eventId: 'e1', ...at(3) }] });
    calendar.findAttendeeEvents.mockImplementationOnce(async () => { throw Object.assign(new Error('boom for bad@x.co'), { code: 'timeout' }); });
    const out = await svc.matchAppointments({ Order, calendar, now: () => NOW });
    expect(out).toEqual({ checked: 2, matched: 1, failed: 1 });
    expect(Order.rows[0].lastCheckedAt).toEqual(NOW); // moved to the back of the queue
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('order 1');
    expect(logged).not.toContain('bad@x.co');
  });

  test('the least recently checked orders go first, at most 50 per sweep', async () => {
    const rows = Array.from({ length: 55 }, (_, i) => row(String(i), { lastCheckedAt: new Date(NOW.getTime() - (i + 1) * 60000) }));
    const Order = makeOrderModel(rows);
    expect((await svc.matchAppointments({ Order, calendar: calendarWith(), now: () => NOW })).checked).toBe(50);
    // rows 5..54 are the 50 checked longest ago (row 54 is the oldest)
    expect(rows.slice(5).every(r => r.lastCheckedAt.getTime() === NOW.getTime())).toBe(true);
    expect(rows.slice(0, 5).every(r => r.lastCheckedAt.getTime() !== NOW.getTime())).toBe(true);
  });
});

describe('activeForEmail / listForEmail / deleteForEmail', () => {
  test('the earliest appointment that has not ended wins over unmatched orders', async () => {
    const Order = makeOrderModel([
      row('late', { appointment: { eventId: 'e2', ...at(9), matchedAt: NOW } }),
      row('soon', { appointment: { eventId: 'e1', ...at(2), matchedAt: NOW } }),
      row('unmatched', { paidAt: NOW }),
    ]);
    expect((await svc.activeForEmail('ADA@x.co', { Order, now: () => NOW })).orderId).toBe('soon');
  });

  test('otherwise the newest unmatched order; ended or too old orders -> null', async () => {
    const Order = makeOrderModel([
      row('older', { paidAt: new Date(NOW.getTime() - 5 * DAY) }),
      row('newer', { paidAt: new Date(NOW.getTime() - 2 * DAY) }),
    ]);
    expect((await svc.activeForEmail('ada@x.co', { Order, now: () => NOW })).orderId).toBe('newer');
    const Done = makeOrderModel([
      row('ended', { appointment: { eventId: 'e0', ...at(-1), matchedAt: NOW } }),
      row('old', { paidAt: new Date(NOW.getTime() - 61 * DAY) }),
    ]);
    expect(await svc.activeForEmail('ada@x.co', { Order: Done, now: () => NOW })).toBeNull();
    expect(await svc.activeForEmail('', { Order: Done, now: () => NOW })).toBeNull();
  });

  test('listForEmail returns the customer orders newest first; deleteForEmail removes only theirs', async () => {
    const Order = makeOrderModel([
      row('a', { paidAt: new Date(NOW.getTime() - 3 * DAY) }),
      row('b', { paidAt: NOW }),
      row('c', { email: 'bob@x.co' }),
    ]);
    expect((await svc.listForEmail('Ada@x.co', { Order })).map(o => o.orderId)).toEqual(['b', 'a']);
    await svc.deleteForEmail('ADA@x.co', { Order });
    expect(Order.rows.map(r => r.orderId)).toEqual(['c']);
  });
});
