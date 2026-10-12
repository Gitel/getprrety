// Tests for bookingPayments.js with an in-memory fake Booking model, fake calendar and fake clock
// (no database, no network). The fake understands just the query operators the service uses.
jest.mock('./bookings', () => ({
  eventText: (user, note, userId) => ({ summary: `Consultation - ${user.firstName}`, description: `Email: ${user.email}\nuser ${userId}` }),
}));

const { recordPayment, syncCalendarEvents } = require('./bookingPayments');

const NOW = new Date('2026-10-12T10:00:00Z');
const FUTURE = new Date('2026-10-20T09:00:00Z');
const ID = 'a'.repeat(24);
const OTHER_ID = 'b'.repeat(24);
const ORDER = { bookingId: ID, orderId: '9001', amount: 150, currency: 'ILS' };

// ---- fake model --------------------------------------------------------------------------------
const getPath = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const norm = v => (v === undefined ? null : v);
const same = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : String(a) === String(b));

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some(f => matches(doc, f));
    const value = norm(getPath(doc, key));
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      return Object.entries(cond).every(([op, arg]) => {
        if (op === '$ne') return Array.isArray(value) ? !value.some(v => same(v, arg)) : !same(value, arg);
        if (op === '$gt') return value !== null && value > arg;
        if (op === '$lt') return value !== null && value < arg;
        throw new Error(`fake: operator ${op}`);
      });
    }
    return cond === null ? value === null : same(value, cond);
  });
}

// A query object that works with `await` and `.lean()` / `.limit()` / `.select()`.
const query = produce => ({
  lean() { return this; }, limit() { return this; }, select() { return this; },
  then(res, rej) { return Promise.resolve().then(produce).then(res, rej); },
});

function makeBooking(rows, { duplicateOnConfirm = false } = {}) {
  const store = rows.map(r => ({ needsAttention: null, calendarClaimedAt: null, calendarEventId: null, holdExpiresAt: null, payment: { status: 'awaiting' }, ...r }));
  const model = {
    store,
    findById: id => query(() => store.find(r => String(r._id) === String(id)) || null),
    find: f => query(() => store.filter(r => matches(r, f))),
    exists: f => query(() => (store.some(r => matches(r, f)) ? { _id: 1 } : null)),
    findOneAndUpdate: jest.fn((f, update) => query(() => {
      const row = store.find(r => matches(r, f));
      if (!row) return null;
      if (duplicateOnConfirm && update.$set.status === 'confirmed') {
        const err = new Error('E11000 duplicate key'); err.code = 11000; err.keyPattern = { startsAt: 1 }; throw err;
      }
      Object.assign(row, update.$set);
      // $addToSet: push the value into the (nested) array unless it is already there.
      for (const [path, value] of Object.entries(update.$addToSet || {})) {
        const keys = path.split('.');
        const last = keys.pop();
        const parent = keys.reduce((o, k) => { o[k] = o[k] || {}; return o[k]; }, row);
        parent[last] = parent[last] || [];
        if (!parent[last].includes(value)) parent[last].push(value);
      }
      return row;
    })),
    updateMany: jest.fn((f, update) => query(() => {
      const hit = store.filter(r => matches(r, f));
      hit.forEach(r => Object.assign(r, update.$set));
      return { modifiedCount: hit.length };
    })),
  };
  return model;
}

const pending = (extra = {}) => ({ _id: ID, userId: 'u1', startsAt: FUTURE, endsAt: new Date(FUTURE.getTime() + 1800000), status: 'pending_payment', holdExpiresAt: new Date(NOW.getTime() + 600000), ...extra });
const deps = (Booking, extra = {}) => ({ Booking, now: () => NOW, ...extra });

let errorSpy;
beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => errorSpy.mockRestore());

describe('recordPayment', () => {
  test('bad or unknown id -> booking_not_found', async () => {
    const Booking = makeBooking([]);
    expect(await recordPayment({ ...ORDER, bookingId: 'nope' }, deps(Booking))).toEqual({ ok: true, result: 'booking_not_found' });
    expect(await recordPayment(ORDER, deps(Booking))).toEqual({ ok: true, result: 'booking_not_found' });
  });

  test('pending hold -> confirmed with the payment block and no hold expiry', async () => {
    const Booking = makeBooking([pending()]);
    expect(await recordPayment(ORDER, deps(Booking))).toEqual({ ok: true, result: 'confirmed' });
    const row = Booking.store[0];
    expect(row.status).toBe('confirmed');
    expect(row.holdExpiresAt).toBeNull();
    expect(row.payment).toEqual({ status: 'paid', amount: 150, currency: 'ILS', providerRef: '9001', paidAt: NOW });
    expect(Booking.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: ID, status: 'pending_payment' }); // conditional
  });

  test('expired hold that is paid late still wins a free slot', async () => {
    const Booking = makeBooking([pending({ status: 'expired' })]);
    expect(await recordPayment(ORDER, deps(Booking))).toEqual({ ok: true, result: 'confirmed' });
    expect(Booking.store[0].status).toBe('confirmed');
  });

  test('same order delivered twice -> already_recorded, no second write', async () => {
    const Booking = makeBooking([pending()]);
    await recordPayment(ORDER, deps(Booking));
    Booking.findOneAndUpdate.mockClear();
    expect(await recordPayment(ORDER, deps(Booking))).toEqual({ ok: true, result: 'already_recorded' });
    expect(Booking.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('concurrency: the conditional update loses -> re-read -> already_recorded', async () => {
    const Booking = makeBooking([pending()]);
    const realUpdate = Booking.findOneAndUpdate.getMockImplementation();
    // Simulate the other delivery winning between our read and our write.
    Booking.findOneAndUpdate.mockImplementationOnce(() => {
      Object.assign(Booking.store[0], { status: 'confirmed', payment: { status: 'paid', providerRef: '9001' } });
      return query(() => null);
    });
    expect(await recordPayment(ORDER, deps(Booking))).toEqual({ ok: true, result: 'already_recorded' });
    Booking.findOneAndUpdate.mockImplementation(realUpdate);
  });

  test('keeps losing the race -> throws so Shopify retries', async () => {
    const Booking = makeBooking([pending()]);
    Booking.findOneAndUpdate.mockImplementation(() => query(() => null));
    await expect(recordPayment(ORDER, deps(Booking))).rejects.toThrow('could not settle');
  });

  test('duplicate key on the confirmed index -> paid_slot_lost, row stays expired', async () => {
    const Booking = makeBooking([pending()], { duplicateOnConfirm: true });
    const out = await recordPayment(ORDER, deps(Booking));
    expect(out).toEqual({ ok: true, result: 'needs_attention', needsAttention: 'paid_slot_lost' });
    expect(Booking.store[0]).toMatchObject({ status: 'expired', needsAttention: 'paid_slot_lost', payment: { status: 'paid', providerRef: '9001' } });
  });

  test('another kind of database error is not swallowed', async () => {
    const Booking = makeBooking([pending()]);
    Booking.findOneAndUpdate.mockImplementation(() => query(() => { throw new Error('boom'); }));
    await expect(recordPayment(ORDER, deps(Booking))).rejects.toThrow('boom');
  });

  test('cancelled row -> paid_after_cancel, stays cancelled, payment recorded', async () => {
    const Booking = makeBooking([pending({ status: 'cancelled' })]);
    const out = await recordPayment(ORDER, deps(Booking));
    expect(out).toEqual({ ok: true, result: 'needs_attention', needsAttention: 'paid_after_cancel' });
    expect(Booking.store[0]).toMatchObject({ status: 'cancelled', needsAttention: 'paid_after_cancel', payment: { providerRef: '9001' } });
  });

  test('already paid with a different order -> paid_extra, first payment kept', async () => {
    const Booking = makeBooking([pending({ status: 'confirmed', payment: { status: 'paid', providerRef: '1111', amount: 150, currency: 'ILS' } })]);
    const out = await recordPayment(ORDER, deps(Booking));
    expect(out).toEqual({ ok: true, result: 'needs_attention', needsAttention: 'paid_extra' });
    expect(Booking.store[0].payment.providerRef).toBe('1111');
    expect(Booking.store[0].needsAttention).toBe('paid_extra');
  });

  test('second order on a paid row: stored in extraRefs, flagged once, re-delivery is already_recorded (never throws)', async () => {
    const Booking = makeBooking([pending({ status: 'confirmed', payment: { status: 'paid', providerRef: '1111' } })]);
    const out = await recordPayment(ORDER, deps(Booking));
    expect(out).toEqual({ ok: true, result: 'needs_attention', needsAttention: 'paid_extra' });
    expect(Booking.store[0].payment.extraRefs).toEqual(['9001']);
    // Shopify re-delivers the extra order: recognised, no new write, no throw.
    Booking.findOneAndUpdate.mockClear();
    await expect(recordPayment(ORDER, deps(Booking))).resolves.toEqual({ ok: true, result: 'already_recorded' });
    expect(Booking.findOneAndUpdate).not.toHaveBeenCalled();
    // The main order is still recognised too.
    expect(await recordPayment({ ...ORDER, orderId: '1111' }, deps(Booking))).toEqual({ ok: true, result: 'already_recorded' });
  });

  test('second order on an already flagged row: keeps its flag, adds the order to extraRefs', async () => {
    const Booking = makeBooking([pending({ status: 'cancelled', needsAttention: 'paid_after_cancel', payment: { status: 'paid', providerRef: '1111', extraRefs: ['2222'] } })]);
    const out = await recordPayment(ORDER, deps(Booking));
    expect(out).toEqual({ ok: true, result: 'needs_attention', needsAttention: 'paid_after_cancel' });
    expect(Booking.store[0].needsAttention).toBe('paid_after_cancel');
    expect(Booking.store[0].payment.extraRefs).toEqual(['2222', '9001']);
    expect(await recordPayment({ ...ORDER, orderId: '2222' }, deps(Booking))).toEqual({ ok: true, result: 'already_recorded' });
  });

  // Round-2 review N1: an admin marked the row handled, then the customer paid AGAIN - the row must
  // come back to Needs attention (the extra money needs a refund), not stay hidden.
  test('a new order on a row already marked handled reopens it in Needs attention', async () => {
    const Booking = makeBooking([pending({
      status: 'cancelled', needsAttention: 'paid_after_cancel', payment: { status: 'paid', providerRef: '1111', extraRefs: [] },
      attentionHandledAt: new Date(NOW.getTime() - 3600000), attentionHandledByAdminEmail: 'admin@example.test',
    })]);
    const out = await recordPayment(ORDER, deps(Booking));
    expect(out).toEqual({ ok: true, result: 'needs_attention', needsAttention: 'paid_after_cancel' });
    expect(Booking.store[0]).toMatchObject({ attentionHandledAt: null, attentionHandledByAdminEmail: null });
    expect(Booking.store[0].payment.extraRefs).toEqual(['9001']);
  });

  test.each(['pending_payment', 'expired'])('payment after the start time (%s row) -> paid_slot_lost, stays expired, not confirmed', async status => {
    const Booking = makeBooking([pending({ status, startsAt: new Date(NOW.getTime() - 60000) })]);
    const out = await recordPayment(ORDER, deps(Booking));
    expect(out).toEqual({ ok: true, result: 'needs_attention', needsAttention: 'paid_slot_lost' });
    expect(Booking.store[0]).toMatchObject({ status: 'expired', holdExpiresAt: null, needsAttention: 'paid_slot_lost', payment: { status: 'paid', providerRef: '9001' } });
  });

  test('user already has another confirmed upcoming booking -> paid_extra, no second confirmation', async () => {
    const Booking = makeBooking([
      pending(),
      { _id: OTHER_ID, userId: 'u1', startsAt: new Date('2026-10-25T09:00:00Z'), status: 'confirmed' },
    ]);
    const out = await recordPayment(ORDER, deps(Booking));
    expect(out).toEqual({ ok: true, result: 'needs_attention', needsAttention: 'paid_extra' });
    expect(Booking.store[0]).toMatchObject({ status: 'expired', needsAttention: 'paid_extra', payment: { providerRef: '9001' } });
    expect(Booking.store[1].status).toBe('confirmed');
  });

  test('confirming expires the same user\'s other holds and another user\'s hold on the same start', async () => {
    const Booking = makeBooking([
      pending(),
      { _id: 'c'.repeat(24), userId: 'u1', startsAt: new Date('2026-10-22T09:00:00Z'), status: 'pending_payment' }, // my other hold
      { _id: 'd'.repeat(24), userId: 'u2', startsAt: FUTURE, status: 'pending_payment' },                          // their hold, same slot
      { _id: 'e'.repeat(24), userId: 'u2', startsAt: new Date('2026-10-23T09:00:00Z'), status: 'pending_payment' }, // unrelated
    ]);
    await recordPayment(ORDER, deps(Booking));
    expect(Booking.store.map(r => r.status)).toEqual(['confirmed', 'expired', 'expired', 'pending_payment']);
  });

  test('logs carry ids only, no payload', async () => {
    const Booking = makeBooking([pending({ status: 'cancelled' })]);
    await recordPayment(ORDER, deps(Booking));
    expect(errorSpy.mock.calls.map(c => c.join(' ')).join('\n')).toMatch(ID);
  });
});

describe('syncCalendarEvents', () => {
  const confirmed = (extra = {}) => pending({ status: 'confirmed', note: 'hi', payment: { status: 'paid', amount: 150, currency: 'ILS', providerRef: '9001' }, ...extra });
  const User = { findById: () => query(() => ({ email: 'a@b.c', firstName: 'Dana' })) };
  const calendar = (extra = {}) => ({ createEvent: jest.fn().mockResolvedValue({ eventId: 'ev1' }), deleteEvent: jest.fn().mockResolvedValue(), ...extra });

  test('claims the row, creates the event with the Paid line, stores the event id and calendar id', async () => {
    process.env.GOOGLE_CALENDAR_ID = 'cal@x';
    const Booking = makeBooking([confirmed()]);
    const cal = calendar();
    await syncCalendarEvents(deps(Booking, { User, calendar: cal }));
    expect(cal.createEvent).toHaveBeenCalledTimes(1);
    const arg = cal.createEvent.mock.calls[0][0];
    expect(arg.description).toContain('Paid: 150 ILS (Shopify order 9001)');
    expect(arg.summary).toBe('Consultation - Dana');
    expect(arg.eventId).toBe(ID); // the booking id is sent as the Google event id (idempotent retries)
    expect(Booking.store[0]).toMatchObject({ calendarEventId: 'ev1', calendarId: 'cal@x', calendarClaimedAt: NOW });
    delete process.env.GOOGLE_CALENDAR_ID;
  });

  test('one writer: a fresh claim blocks, a claim older than 60 s is taken over', async () => {
    const Booking = makeBooking([confirmed({ calendarClaimedAt: new Date(NOW.getTime() - 10000) })]);
    const cal = calendar();
    await syncCalendarEvents(deps(Booking, { User, calendar: cal }));
    expect(cal.createEvent).not.toHaveBeenCalled();

    Booking.store[0].calendarClaimedAt = new Date(NOW.getTime() - 61000);
    await syncCalendarEvents(deps(Booking, { User, calendar: cal }));
    expect(cal.createEvent).toHaveBeenCalledTimes(1);
  });

  test('skips rows that already have an event, are past, or are not confirmed', async () => {
    const Booking = makeBooking([
      confirmed({ calendarEventId: 'x' }),
      confirmed({ _id: OTHER_ID, startsAt: new Date('2026-10-01T09:00:00Z') }),
      confirmed({ _id: 'c'.repeat(24), status: 'pending_payment' }),
    ]);
    const cal = calendar();
    await syncCalendarEvents(deps(Booking, { User, calendar: cal }));
    expect(cal.createEvent).not.toHaveBeenCalled();
  });

  test('cancelled while the event was being created -> the new event is deleted, no id saved', async () => {
    const Booking = makeBooking([confirmed()]);
    const cal = calendar({
      createEvent: jest.fn(async () => { Booking.store[0].status = 'cancelled'; return { eventId: 'ev9' }; }),
    });
    await syncCalendarEvents(deps(Booking, { User, calendar: cal }));
    expect(cal.deleteEvent).toHaveBeenCalledWith('ev9');
    expect(Booking.store[0].calendarEventId).toBeNull();
  });

  test('calendar failure: logged safely, never thrown, retried once the claim expires', async () => {
    const Booking = makeBooking([confirmed()]);
    const err = Object.assign(new Error('secret@x.com raw detail'), { reason: 'rateLimitExceeded', status: 403 });
    const cal = calendar({ createEvent: jest.fn().mockRejectedValueOnce(err).mockResolvedValue({ eventId: 'ev2' }) });
    await expect(syncCalendarEvents(deps(Booking, { User, calendar: cal }))).resolves.toBeUndefined();
    const logged = errorSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toContain(ID);
    expect(logged).toContain('rateLimitExceeded');
    expect(logged).not.toContain('secret@x.com');
    expect(Booking.store[0].calendarEventId).toBeNull();

    // Next sweep, after the 60 s claim has aged out: succeeds.
    await syncCalendarEvents(deps(Booking, { User, calendar: cal, now: () => new Date(NOW.getTime() + 61000) }));
    expect(Booking.store[0].calendarEventId).toBe('ev2');
  });

  test('listing failure never throws', async () => {
    const Booking = { find: () => query(() => { throw new Error('db down'); }) };
    await expect(syncCalendarEvents(deps(Booking))).resolves.toBeUndefined();
  });
});
