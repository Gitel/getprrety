// Tests for services/bookings.js (the booking business rules). NO database and NO Google:
// every dependency (Booking, BookingConfig, User, SkinAnalysis, calendar) is an in-memory fake
// passed in as the last `deps` argument, like catalogueProducts.test.js does.
const mongoose = require('mongoose'); // only for ObjectId values, we never connect
const realSlots = require('./slots');
const {
  isBookingEnabled, getConfig, getPublicConfig, listSlots, createBooking, listMine,
  listForAdmin, listForUser, cancelBooking, markAttentionHandled, updateConfig, bookingBootLine, releaseUserBookings,
  HOLD_MINUTES, shopifyConfigured, expireHolds, eventText, publicBooking,
} = require('./bookings');

const oid = () => new mongoose.Types.ObjectId();
const isoOf = v => new Date(v).toISOString();

// "Now" is Wednesday 2026-10-07 09:00 clinic time (UTC+3). Lead time 12 h means the first
// bookable start is Thursday 2026-10-08 10:00 (07:00Z).
const NOW = new Date('2026-10-07T06:00:00Z');
const SLOT = '2026-10-08T07:00:00.000Z'; // Thu 10:00 local, a valid grid slot
const CAL_ID = 'clinic@group.calendar.google.com';

const DEFAULTS = {
  enabled: true,
  slotMinutes: 30,
  bufferMinutes: 0,
  leadHours: 12,
  horizonDays: 30,
  timeZone: 'Asia/Jerusalem',
  weekly: [0, 1, 2, 3, 4].map(day => ({ day, open: '10:00', close: '18:00' })),
};

// Same error shape MongoDB raises when the unique partial index on startsAt collides.
const dupStartsAt = () => Object.assign(
  new Error('E11000 duplicate key error collection: getprrety.bookings index: startsAt_1 dup key'),
  { code: 11000, keyPattern: { startsAt: 1 } },
);

// What calendar.js throws for any Google problem.
class FakeCalendarError extends Error {
  constructor(message = 'calendar down') {
    super(message);
    this.name = 'CalendarError';
    this.code = 'calendar_unavailable';
  }
}

// ---------------------------------------------------------------------------------------------
// Tiny in-memory "mongoose" so the service can run its real queries without a database.
// ---------------------------------------------------------------------------------------------
const sameValue = (a, b) => (a instanceof Date || b instanceof Date
  ? new Date(a).getTime() === new Date(b).getTime()
  : String(a) === String(b));

// Supports plain equality plus $gt/$gte/$lt/$lte/$in/$ne, which is all the service uses.
function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some(sub => matches(doc, sub)); // any one branch may match
    const value = doc[key];
    const isOps = cond && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof mongoose.Types.ObjectId)
      && Object.keys(cond).some(k => k.startsWith('$'));
    if (!isOps) return sameValue(value, cond);
    return Object.entries(cond).every(([op, arg]) => {
      if (op === '$in') return arg.some(a => sameValue(value, a));
      if (op === '$ne') return arg === null ? value !== null && value !== undefined : !sameValue(value, arg);
      const [v, a] = [new Date(value).getTime(), new Date(arg).getTime()];
      if (op === '$gt') return v > a;
      if (op === '$gte') return v >= a;
      if (op === '$lt') return v < a;
      if (op === '$lte') return v <= a;
      throw new Error(`fake matcher: unsupported operator ${op}`);
    });
  });
}

// A thenable, chainable stand-in for a mongoose Query (await it, or call .lean()/.sort()/...).
function query(run, populateFrom) {
  const q = {
    _sort: null, _limit: null, _populate: false,
    sort(s) { q._sort = s; return q; },
    limit(n) { q._limit = n; return q; },
    lean() { return q; },
    select() { return q; },
    populate() { q._populate = true; return q; },
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        let out = run();
        if (Array.isArray(out)) {
          out = [...out];
          if (q._sort) {
            const [[field, dir]] = Object.entries(q._sort);
            out.sort((a, b) => (new Date(a[field]) - new Date(b[field])) * dir);
          }
          if (q._limit) out = out.slice(0, q._limit);
        }
        if (q._populate && populateFrom) {
          const swap = d => ({ ...d, userId: populateFrom(d.userId) || d.userId });
          out = Array.isArray(out) ? out.map(swap) : (out && swap(out));
        }
        return out;
      }).then(resolve, reject);
    },
  };
  return q;
}

// Documents are plain objects with a (non-enumerable) save() so "doc.field = x; doc.save()" works too.
function makeDoc(fields) {
  const doc = { ...fields };
  Object.defineProperty(doc, 'save', { enumerable: false, value: async () => doc });
  Object.defineProperty(doc, 'toObject', { enumerable: false, value: () => ({ ...doc }) });
  return doc;
}

function applyUpdate(doc, update) {
  Object.assign(doc, update.$set || {}, Object.fromEntries(Object.entries(update).filter(([k]) => !k.startsWith('$'))));
  return doc;
}

// Builds all fakes around shared in-memory state; `world.store` etc. let tests look inside.
function makeWorld({ users = [], bookings = [], analyses = [], config = DEFAULTS } = {}) {
  const world = {
    store: bookings.map(b => makeDoc({
      _id: oid(), status: 'confirmed', note: '', calendarEventId: null, calendarId: '',
      cancelledAt: null, cancelledByAdminEmail: null, holdExpiresAt: null, needsAttention: null, attentionHandledAt: null, ...b,
    })),
    users: users.map(u => makeDoc({ _id: oid(), ...u })),
    analyses,
    cfg: config && makeDoc({ key: 'main', ...config }),
  };
  const byId = (list, id) => list.find(d => String(d._id) === String(id)) || null;

  const Booking = {
    find: jest.fn(f => query(() => world.store.filter(d => matches(d, f)), id => byId(world.users, id))),
    findOne: jest.fn(f => query(() => world.store.find(d => matches(d, f)) || null)),
    findById: jest.fn(id => query(() => byId(world.store, id))),
    exists: jest.fn(f => query(() => { const d = world.store.find(x => matches(x, f)); return d ? { _id: d._id } : null; })),
    countDocuments: jest.fn(f => query(() => world.store.filter(d => matches(d, f)).length)),
    create: jest.fn(async input => {
      const status = input.status || 'confirmed';
      // Mirrors the two partial unique indexes: one per status (confirmed / pending_payment), same start time.
      if ((status === 'confirmed' || status === 'pending_payment')
        && world.store.some(d => d.status === status && sameValue(d.startsAt, input.startsAt))) throw dupStartsAt();
      const doc = makeDoc({
        _id: oid(), status, note: '', calendarEventId: null, calendarId: '',
        cancelledAt: null, cancelledByAdminEmail: null,
        payment: { status: 'none', amount: null, currency: null, providerRef: null },
        ...input,
      });
      world.store.push(doc);
      return doc;
    }),
    deleteOne: jest.fn(async f => {
      const i = world.store.findIndex(d => matches(d, f));
      if (i >= 0) world.store.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    }),
    updateMany: jest.fn(async (f, update) => {
      const hit = world.store.filter(x => matches(x, f));
      hit.forEach(x => applyUpdate(x, update));
      return { matchedCount: hit.length, modifiedCount: hit.length };
    }),
    updateOne: jest.fn(async (f, update) => {
      const d = world.store.find(x => matches(x, f));
      if (d) applyUpdate(d, update);
      return { matchedCount: d ? 1 : 0 };
    }),
    findOneAndUpdate: jest.fn((f, update) => query(() => { const d = world.store.find(x => matches(x, f)); return d ? applyUpdate(d, update) : null; })),
    findByIdAndUpdate: jest.fn((id, update) => query(() => { const d = byId(world.store, id); return d ? applyUpdate(d, update) : null; })),
  };

  const User = {
    findById: jest.fn(id => query(() => byId(world.users, id))),
    findOne: jest.fn(f => query(() => world.users.find(u => matches(u, f)) || null)),
    find: jest.fn(f => query(() => world.users.filter(u => matches(u, f)))),
  };

  const SkinAnalysis = {
    exists: jest.fn(f => query(() => (world.analyses.some(a => String(a) === String(f.userId)) ? { _id: oid() } : null))),
    findOne: jest.fn(f => query(() => (world.analyses.some(a => String(a) === String(f.userId)) ? { _id: oid() } : null))),
  };

  // The singleton config. findOneAndUpdate with upsert creates it from $setOnInsert.
  const upsert = (update, opts = {}) => {
    if (!world.cfg && opts.upsert) world.cfg = makeDoc({ key: 'main', ...(update.$setOnInsert || {}), ...(update.$set || {}) });
    else if (world.cfg) applyUpdate(world.cfg, update);
    return world.cfg;
  };
  const BookingConfig = {
    DEFAULTS,
    SLOT_MINUTES: [15, 20, 30, 45, 60],
    findOne: jest.fn(() => query(() => world.cfg)),
    findOneAndUpdate: jest.fn((f, update, opts) => query(() => upsert(update, opts))),
    updateOne: jest.fn(async (f, update, opts) => { upsert(update, opts); return {}; }),
  };

  const calendar = {
    isConfigured: jest.fn(() => true),
    getBusy: jest.fn(async () => []),
    createEvent: jest.fn(async () => ({ eventId: 'evt-1' })),
    deleteEvent: jest.fn(async () => {}),
  };

  world.deps = { Booking, BookingConfig, User, SkinAnalysis, calendar, slots: realSlots, now: () => NOW };
  world.Booking = Booking;
  world.calendar = calendar;
  world.config = () => world.cfg;
  return world;
}

// ---------------------------------------------------------------------------------------------
const SHOPIFY_ENV = ['SHOPIFY_STORE_URL', 'SHOPIFY_CONSULTATION_VARIANT_ID', 'SHOPIFY_WEBHOOK_SECRET'];
let savedEnv;
beforeEach(() => {
  savedEnv = {};
  for (const k of ['BOOKING_ENABLED', 'GOOGLE_CALENDAR_ID', 'PUBLIC_BASE_URL', ...SHOPIFY_ENV]) savedEnv[k] = process.env[k];
  process.env.BOOKING_ENABLED = '1';
  process.env.SHOPIFY_STORE_URL = 'https://shop.test/'; // trailing slash on purpose: the link must not double it
  process.env.SHOPIFY_CONSULTATION_VARIANT_ID = '12345';
  process.env.SHOPIFY_WEBHOOK_SECRET = 'whsec-test';
  process.env.GOOGLE_CALENDAR_ID = CAL_ID;
  process.env.PUBLIC_BASE_URL = 'https://app.test';
});
afterEach(() => {
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
  jest.restoreAllMocks();
});

// A world with one signed-up user who has a skin analysis (so no warning by default).
function userWorld(over = {}) {
  const userId = oid();
  const world = makeWorld({
    users: [{
      _id: userId, email: 'dana@example.com', firstName: 'Dana',
      // Sensitive fields that must NEVER reach the calendar event text:
      skinType: 'oily', quizAnswers: { allergies: 'penicillin', pregnant: 'yes' },
    }],
    analyses: [userId],
    ...over,
  });
  return { world, userId, deps: world.deps };
}

// ---------------------------------------------------------------------------------------------
describe('isBookingEnabled / getConfig / getPublicConfig', () => {
  test('on only when env flag, configured calendar and config.enabled ALL hold', async () => {
    const { world, deps } = userWorld();
    expect(await isBookingEnabled(deps)).toBe(true);

    for (const flag of ['0', '', 'yes', undefined]) {
      if (flag === undefined) delete process.env.BOOKING_ENABLED; else process.env.BOOKING_ENABLED = flag;
      expect(await isBookingEnabled(deps)).toBe(false);
    }
    process.env.BOOKING_ENABLED = 'true';
    expect(await isBookingEnabled(deps)).toBe(true);

    world.calendar.isConfigured.mockReturnValue(false);
    expect(await isBookingEnabled(deps)).toBe(false);
    world.calendar.isConfigured.mockReturnValue(true);

    world.config().enabled = false;
    expect(await isBookingEnabled(deps)).toBe(false);
  });

  test('Shopify env gating: each of the three settings is required, shopifyConfigured says so', async () => {
    const { world, deps } = userWorld();
    expect(shopifyConfigured()).toBe(true);
    for (const name of SHOPIFY_ENV) {
      const saved = process.env[name];
      process.env[name] = '';
      expect(shopifyConfigured()).toBe(false);
      expect(await isBookingEnabled(deps)).toBe(false);
      delete process.env[name];
      expect(await isBookingEnabled(deps)).toBe(false);
      process.env[name] = saved;
    }
    expect(await isBookingEnabled(deps)).toBe(true);
    expect(world.calendar.getBusy).not.toHaveBeenCalled();
  });

  test('getConfig creates the singleton from DEFAULTS on first use (upsert)', async () => {
    const world = makeWorld({ config: null });
    expect(world.config()).toBeNull();
    const cfg = await getConfig(world.deps);
    expect(world.config()).toMatchObject({ key: 'main', ...DEFAULTS });
    expect(cfg).toMatchObject(DEFAULTS);
  });

  test('getPublicConfig exposes only the five safe fields; disabled is {enabled:false}', async () => {
    const { world, deps } = userWorld();
    expect(await getPublicConfig(deps)).toEqual({ enabled: true, slotMinutes: 30, leadHours: 12, horizonDays: 30, timeZone: 'Asia/Jerusalem' });
    delete process.env.BOOKING_ENABLED;
    expect(await getPublicConfig(deps)).toMatchObject({ enabled: false });
    expect(world.calendar.getBusy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
describe('createBooking: happy path (a paid-booking HOLD, no calendar event yet)', () => {
  // INTENDED behaviour change (paid booking): create used to confirm at once and write the calendar
  // event. It now only inserts a pending_payment hold; the event is written after payment.
  test('returns the public hold booking and inserts a pending_payment row with a 15 minute hold', async () => {
    const { world, userId, deps } = userWorld();
    const result = await createBooking(userId, { startsAt: SLOT, note: 'First visit' }, deps);

    expect(result.ok).toBe(true);
    expect(result.warning).toBeNull();
    expect(Object.keys(result.booking).sort()).toEqual(
      ['checkoutUrl', 'date', 'endsAt', 'holdExpiresAt', 'id', 'note', 'startsAt', 'status', 'time'],
    );
    expect(result.booking).toMatchObject({ date: '2026-10-08', time: '10:00', status: 'pending_payment', note: 'First visit' });
    expect(isoOf(result.booking.startsAt)).toBe(SLOT);
    expect(isoOf(result.booking.endsAt)).toBe('2026-10-08T07:30:00.000Z');
    expect(HOLD_MINUTES).toBe(15);
    expect(result.booking.holdExpiresAt).toBe(new Date(NOW.getTime() + 15 * 60000).toISOString());

    const created = world.Booking.create.mock.calls[0][0];
    expect(created).toMatchObject({
      status: 'pending_payment', calendarEventId: null, note: 'First visit', payment: { status: 'awaiting' },
    });
    expect(created.holdExpiresAt.getTime()).toBe(NOW.getTime() + 15 * 60000);
    expect(String(created.userId)).toBe(String(userId));
    expect(world.store).toHaveLength(1);
    expect(String(result.booking.id)).toBe(String(world.store[0]._id));
  });

  test('NO calendar event is created or deleted when booking (it is written after payment)', async () => {
    const { world, userId, deps } = userWorld();
    await createBooking(userId, { startsAt: SLOT }, deps);
    expect(world.calendar.createEvent).not.toHaveBeenCalled();
    expect(world.calendar.deleteEvent).not.toHaveBeenCalled();
    expect(world.store[0].calendarEventId).toBeNull();
  });

  test('the returned checkoutUrl points at the Shopify cart with the booking id and the email', async () => {
    const { userId, deps } = userWorld();
    const { booking } = await createBooking(userId, { startsAt: SLOT }, deps);
    expect(booking.checkoutUrl).toBe(
      `https://shop.test/cart/12345:1?attributes%5Bgetpretty_booking%5D=${booking.id}&checkout%5Bemail%5D=dana%40example.com`,
    );
  });

  test('warning is no_analysis when the user has no SkinAnalysis, still ok:true', async () => {
    const userId = oid();
    const world = makeWorld({ users: [{ _id: userId, email: 'x@example.com', firstName: 'X' }], analyses: [] });
    const result = await createBooking(userId, { startsAt: SLOT }, world.deps);
    expect(result).toMatchObject({ ok: true, warning: 'no_analysis' });
  });

  test('the calendar is asked with fresh:true, for a range that contains the slot', async () => {
    const { world, userId, deps } = userWorld();
    await createBooking(userId, { startsAt: SLOT }, deps);
    const [range, opts] = world.calendar.getBusy.mock.calls[0];
    expect(opts).toEqual({ fresh: true });
    expect(range.start.getTime()).toBeLessThanOrEqual(Date.parse(SLOT));
    expect(range.end.getTime()).toBeGreaterThanOrEqual(Date.parse('2026-10-08T07:30:00Z'));
  });
});

describe('eventText (used by bookingPayments.js when the event is written after payment)', () => {
  test('first name, email, note and admin link in the contract text', () => {
    const userId = oid();
    const ev = eventText({ email: 'dana@example.com', firstName: 'Dana', skinType: 'oily', quizAnswers: { allergies: 'penicillin' } }, 'First visit', userId);
    expect(ev.summary).toBe('Consultation - Dana');
    expect(ev.description.trim().split(/\r?\n/)).toEqual([
      'Booked in the GetPretty app.',
      'Email: dana@example.com',
      'Note: First visit',
      `Client page: https://app.test/admin/users/${userId}`,
    ]);
    // no health data
    const text = `${ev.summary}\n${ev.description}`;
    for (const secret of ['penicillin', 'oily', 'allergies', 'skinType']) expect(text).not.toContain(secret);
  });

  test('no note and no PUBLIC_BASE_URL: those two lines are omitted; no first name -> "client"', () => {
    delete process.env.PUBLIC_BASE_URL;
    const ev = eventText({ email: 'x@example.com' }, '', oid());
    expect(ev.summary).toBe('Consultation - client');
    expect(ev.description.trim().split(/\r?\n/)).toEqual(['Booked in the GetPretty app.', 'Email: x@example.com']);
  });
});

describe('publicBooking: holdExpiresAt and checkoutUrl', () => {
  const row = over => ({
    _id: oid(), status: 'pending_payment', startsAt: new Date(SLOT), endsAt: new Date('2026-10-08T07:30:00Z'), note: '',
    holdExpiresAt: new Date(NOW.getTime() + 5 * 60000), ...over,
  });

  test('live pending row: ISO holdExpiresAt and a URLSearchParams-encoded checkoutUrl (store slash removed)', () => {
    const b = row();
    const pub = publicBooking(b, 'Asia/Jerusalem', realSlots, { email: 'a+b@example.com' }, NOW);
    expect(pub.holdExpiresAt).toBe(new Date(b.holdExpiresAt).toISOString());
    expect(pub.checkoutUrl).toBe(
      `https://shop.test/cart/12345:1?attributes%5Bgetpretty_booking%5D=${b._id}&checkout%5Bemail%5D=a%2Bb%40example.com`,
    );
  });

  test.each([
    ['confirmed', { status: 'confirmed', holdExpiresAt: null }],
    ['an expired status', { status: 'expired' }],
    ['a pending row whose hold ran out', { holdExpiresAt: new Date(NOW.getTime() - 1000) }],
    ['a cancelled row', { status: 'cancelled' }],
  ])('%s -> holdExpiresAt and checkoutUrl are null', (_label, over) => {
    const pub = publicBooking(row(over), 'Asia/Jerusalem', realSlots, { email: 'a@example.com' }, NOW);
    expect(pub.holdExpiresAt).toBeNull();
    expect(pub.checkoutUrl).toBeNull();
  });
});

describe('createBooking: step 1 validation (nothing touches the calendar or the bookings)', () => {
  const untouched = world => {
    expect(world.Booking.create).not.toHaveBeenCalled();
    expect(world.calendar.getBusy).not.toHaveBeenCalled();
    expect(world.calendar.createEvent).not.toHaveBeenCalled();
  };

  test('disabled (env flag off, calendar not configured, or config switched off) -> booking_disabled', async () => {
    const { world, userId, deps } = userWorld();
    delete process.env.BOOKING_ENABLED;
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'booking_disabled' });
    process.env.BOOKING_ENABLED = '1';
    world.calendar.isConfigured.mockReturnValue(false);
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'booking_disabled' });
    world.calendar.isConfigured.mockReturnValue(true);
    world.config().enabled = false;
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'booking_disabled' });
    untouched(world);
  });

  test('disabled wins over every other problem', async () => {
    const { world, userId, deps } = userWorld();
    delete process.env.BOOKING_ENABLED;
    expect(await createBooking(userId, { startsAt: 'garbage', note: 'x'.repeat(999) }, deps)).toEqual({ ok: false, code: 'booking_disabled' });
    untouched(world);
  });

  test.each([
    ['301 characters', 'x'.repeat(301)],
    ['a number', 123],
    ['an object', { a: 1 }],
  ])('a note that is %s -> note_too_long', async (_label, note) => {
    const { world, userId, deps } = userWorld();
    expect(await createBooking(userId, { startsAt: SLOT, note }, deps)).toEqual({ ok: false, code: 'note_too_long' });
    untouched(world);
  });

  test('note limit is measured AFTER trimming: 300 characters (even padded with spaces) is fine', async () => {
    const { userId, deps } = userWorld();
    const result = await createBooking(userId, { startsAt: SLOT, note: ` ${'x'.repeat(300)} ` }, deps);
    expect(result.ok).toBe(true);
  });

  test('note_too_long is reported before slot_invalid', async () => {
    const { userId, deps } = userWorld();
    expect(await createBooking(userId, { startsAt: 'garbage', note: 'x'.repeat(301) }, deps)).toEqual({ ok: false, code: 'note_too_long' });
  });

  test.each([undefined, null, '', 'garbage', '2026-13-45T99:00:00Z'])('startsAt %p -> slot_invalid', async startsAt => {
    const { world, userId, deps } = userWorld();
    expect(await createBooking(userId, { startsAt }, deps)).toEqual({ ok: false, code: 'slot_invalid' });
    untouched(world);
  });

  test('unknown user -> account_not_found', async () => {
    const { world, deps } = userWorld();
    expect(await createBooking(oid(), { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'account_not_found' });
    untouched(world);
  });
});

describe('createBooking: step 2 limit of one upcoming booking', () => {
  test('an existing upcoming confirmed booking -> limit_reached, calendar never asked', async () => {
    const { world, userId, deps } = userWorld();
    world.store.push(makeDoc({ _id: oid(), userId, status: 'confirmed', startsAt: new Date('2026-10-20T07:00:00Z'), endsAt: new Date('2026-10-20T07:30:00Z') }));
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'limit_reached' });
    expect(world.calendar.getBusy).not.toHaveBeenCalled();
    expect(world.Booking.create).not.toHaveBeenCalled();
  });

  test('a past booking, a cancelled booking or somebody else\'s booking does not count', async () => {
    const { world, userId, deps } = userWorld();
    world.store.push(
      makeDoc({ _id: oid(), userId, status: 'confirmed', startsAt: new Date('2026-09-20T07:00:00Z'), endsAt: new Date('2026-09-20T07:30:00Z') }),
      makeDoc({ _id: oid(), userId, status: 'cancelled', startsAt: new Date('2026-10-20T07:00:00Z'), endsAt: new Date('2026-10-20T07:30:00Z') }),
      makeDoc({ _id: oid(), userId: oid(), status: 'confirmed', startsAt: new Date('2026-10-21T07:00:00Z'), endsAt: new Date('2026-10-21T07:30:00Z') }),
    );
    expect((await createBooking(userId, { startsAt: SLOT }, deps)).ok).toBe(true);
  });
});

describe('createBooking: step 1c replaces the user\'s own hold, limit counts live holds', () => {
  const hold = (userId, iso, minutesLeft = 5, status = 'pending_payment') => makeDoc({
    _id: oid(), userId, status, note: '', startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 30 * 60000),
    holdExpiresAt: new Date(NOW.getTime() + minutesLeft * 60000),
  });

  test('picking a new time while holding another: the old hold is expired BEFORE the limit check, new hold created', async () => {
    const { world, userId, deps } = userWorld();
    const old = hold(userId, '2026-10-12T07:00:00Z');
    world.store.push(old);
    const result = await createBooking(userId, { startsAt: SLOT }, deps);
    expect(result.ok).toBe(true);
    expect(old.status).toBe('expired');
    const live = world.store.filter(b => b.status === 'pending_payment');
    expect(live).toHaveLength(1);
    expect(isoOf(live[0].startsAt)).toBe(SLOT);
    // The release happened before the limit check ran (order of the two Booking calls).
    const releaseOrder = world.Booking.updateMany.mock.invocationCallOrder;
    expect(Math.min(...releaseOrder)).toBeLessThan(world.Booking.exists.mock.invocationCallOrder[0]);
  });

  test('re-picking the SAME slot works too (the old hold is released first)', async () => {
    const { world, userId, deps } = userWorld();
    world.store.push(hold(userId, SLOT));
    expect((await createBooking(userId, { startsAt: SLOT }, deps)).ok).toBe(true);
  });

  test('a confirmed upcoming booking still blocks even when the user also holds a slot', async () => {
    const { world, userId, deps } = userWorld();
    world.store.push(makeDoc({ _id: oid(), userId, status: 'confirmed', startsAt: new Date('2026-10-20T07:00:00Z'), endsAt: new Date('2026-10-20T07:30:00Z') }));
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'limit_reached' });
    expect(world.Booking.create).not.toHaveBeenCalled();
  });

  test('a live hold of ANOTHER user blocks the slot (slot_taken)', async () => {
    const { world, userId, deps } = userWorld();
    world.store.push(hold(oid(), SLOT));
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'slot_taken' });
    expect(world.Booking.create).not.toHaveBeenCalled();
  });

  test('a STALE hold of another user does not block: it is expired first and the slot can be booked', async () => {
    const { world, userId, deps } = userWorld();
    const stale = hold(oid(), SLOT, -1);
    world.store.push(stale);
    expect((await createBooking(userId, { startsAt: SLOT }, deps)).ok).toBe(true);
    expect(stale.status).toBe('expired');
  });
});

describe('createBooking: step 3 grid check -> slot_invalid (calendar not asked)', () => {
  test.each([
    ['off the 30 minute grid', '2026-10-08T07:10:00.000Z'],
    ['outside working hours (Thu 18:30 local)', '2026-10-08T15:30:00.000Z'],
    ['a closed day (Friday 10:00 local)', '2026-10-09T07:00:00.000Z'],
    ['before the 12 h lead time (Wed 17:00 local)', '2026-10-07T14:00:00.000Z'],
    ['in the past', '2026-10-01T07:00:00.000Z'],
    ['beyond the 30 day horizon (Sun 8 Nov 10:00 local)', '2026-11-08T08:00:00.000Z'],
  ])('%s', async (_label, startsAt) => {
    const { world, userId, deps } = userWorld();
    expect(await createBooking(userId, { startsAt }, deps)).toEqual({ ok: false, code: 'slot_invalid' });
    expect(world.calendar.getBusy).not.toHaveBeenCalled();
    expect(world.Booking.create).not.toHaveBeenCalled();
  });
});

describe('createBooking: step 4 fresh availability', () => {
  test('a busy clinic calendar at that time -> slot_taken, nothing written', async () => {
    const { world, userId, deps } = userWorld();
    world.calendar.getBusy.mockResolvedValue([{ start: new Date('2026-10-08T06:45:00Z'), end: new Date('2026-10-08T07:15:00Z') }]);
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'slot_taken' });
    expect(world.Booking.create).not.toHaveBeenCalled();
  });

  test('a confirmed booking by someone else at that time -> slot_taken', async () => {
    const { world, userId, deps } = userWorld();
    world.store.push(makeDoc({ _id: oid(), userId: oid(), status: 'confirmed', startsAt: new Date(SLOT), endsAt: new Date('2026-10-08T07:30:00Z') }));
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'slot_taken' });
    expect(world.Booking.create).not.toHaveBeenCalled();
  });

  test('a cancelled booking at that time does not block it', async () => {
    const { world, userId, deps } = userWorld();
    world.store.push(makeDoc({ _id: oid(), userId: oid(), status: 'cancelled', startsAt: new Date(SLOT), endsAt: new Date('2026-10-08T07:30:00Z') }));
    expect((await createBooking(userId, { startsAt: SLOT }, deps)).ok).toBe(true);
  });

  test('calendar failure while reading busy times -> calendar_unavailable and NOTHING is created', async () => {
    const { world, userId, deps } = userWorld();
    world.calendar.getBusy.mockRejectedValue(new FakeCalendarError());
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'calendar_unavailable' });
    expect(world.Booking.create).not.toHaveBeenCalled();
    expect(world.store).toHaveLength(0);
  });
});

describe('createBooking: step 5 double booking (two users, one slot)', () => {
  test('the pending-hold unique index rejecting the second insert -> slot_taken', async () => {
    const { world, userId, deps } = userWorld();
    // The other user's hold exists, but the pre-check read missed it (the race window).
    world.store.push(makeDoc({
      _id: oid(), userId: oid(), status: 'pending_payment', holdExpiresAt: new Date(NOW.getTime() + 600000),
      startsAt: new Date(SLOT), endsAt: new Date('2026-10-08T07:30:00Z'),
    }));
    world.Booking.find.mockImplementation(() => query(() => []));
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'slot_taken' });
    expect(world.store).toHaveLength(1); // only the other user's row
  });

  test('a duplicate-key error naming the NEW compound index (keyPattern startsAt+status) is slot_taken too', async () => {
    const { world, userId, deps } = userWorld();
    world.Booking.create.mockRejectedValueOnce(Object.assign(new Error('E11000 ... index: startsAt_pending_unique dup key'), {
      code: 11000, keyPattern: { startsAt: 1, status: 1 },
    }));
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'slot_taken' });
  });

  test('two users book the same slot one after the other: first wins, second gets slot_taken', async () => {
    const first = oid();
    const second = oid();
    const world = makeWorld({
      users: [{ _id: first, email: 'a@x.com', firstName: 'A' }, { _id: second, email: 'b@x.com', firstName: 'B' }],
      analyses: [first, second],
    });
    expect((await createBooking(first, { startsAt: SLOT }, world.deps)).ok).toBe(true);
    expect(await createBooking(second, { startsAt: SLOT }, world.deps)).toEqual({ ok: false, code: 'slot_taken' }); // first's live hold blocks it
  });
});

describe('createBooking: step 6 race rollback on the one-upcoming-booking limit', () => {
  test('if a second upcoming booking appeared meanwhile, our row is deleted -> limit_reached', async () => {
    const { world, userId, deps } = userWorld();
    // Another request of the SAME user lands while we wait for the calendar (between step 2 and step 5).
    world.calendar.getBusy.mockImplementation(async () => {
      world.store.push(makeDoc({ _id: oid(), userId, status: 'confirmed', startsAt: new Date('2026-10-09T07:00:00Z'), endsAt: new Date('2026-10-09T07:30:00Z') }));
      return [];
    });
    expect(await createBooking(userId, { startsAt: SLOT }, deps)).toEqual({ ok: false, code: 'limit_reached' });
    expect(world.Booking.deleteOne).toHaveBeenCalledTimes(1);
    // Only the competing booking is left; our row (SLOT) was rolled back, so the slot is free again.
    expect(world.store).toHaveLength(1);
    expect(isoOf(world.store[0].startsAt)).toBe('2026-10-09T07:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------------------------
describe('listSlots', () => {
  test('disabled -> booking_disabled', async () => {
    const { deps } = userWorld();
    delete process.env.BOOKING_ENABLED;
    expect(await listSlots({}, deps)).toEqual({ ok: false, code: 'booking_disabled' });
  });

  test.each([
    ['malformed from', { from: 'nope', to: '2026-10-12' }],
    ['malformed to', { from: '2026-10-08', to: '12/10/2026' }],
    ['from after to', { from: '2026-10-12', to: '2026-10-08' }],
    ['a span of more than 31 days', { from: '2026-10-01', to: '2026-11-15' }],
  ])('%s -> invalid_range', async (_label, range) => {
    const { world, deps } = userWorld();
    expect(await listSlots(range, deps)).toEqual({ ok: false, code: 'invalid_range' });
    expect(world.calendar.getBusy).not.toHaveBeenCalled();
  });

  test('no range: from today (clinic time) for the whole horizon, lead time applied', async () => {
    const { deps } = userWorld();
    const result = await listSlots({}, deps);
    expect(result.ok).toBe(true);
    expect(result.timeZone).toBe('Asia/Jerusalem');
    expect(result.slots[0]).toEqual({ startsAt: '2026-10-08T07:00:00.000Z', endsAt: '2026-10-08T07:30:00.000Z', date: '2026-10-08', time: '10:00' });
    // Horizon: Thu 2026-11-05 17:30 local (UTC+2 after DST) is the last Sun-Thu slot before now + 30 d.
    expect(result.slots[result.slots.length - 1].startsAt).toBe('2026-11-05T15:30:00.000Z');
  });

  test('removes calendar busy times and confirmed bookings, but not cancelled ones; exposes no user data', async () => {
    const { world, deps } = userWorld();
    world.calendar.getBusy.mockResolvedValue([{ start: new Date('2026-10-11T07:30:00Z'), end: new Date('2026-10-11T08:15:00Z') }]);
    world.store.push(
      makeDoc({ _id: oid(), userId: oid(), status: 'confirmed', startsAt: new Date('2026-10-11T09:00:00Z'), endsAt: new Date('2026-10-11T09:30:00Z') }), // 12:00
      makeDoc({ _id: oid(), userId: oid(), status: 'cancelled', startsAt: new Date('2026-10-11T09:30:00Z'), endsAt: new Date('2026-10-11T10:00:00Z') }), // 12:30 stays free
    );
    const result = await listSlots({ from: '2026-10-11', to: '2026-10-11' }, deps);
    const times = result.slots.map(s => s.time);
    expect(result.slots).toHaveLength(13); // 16 - 2 busy - 1 booked
    expect(times).not.toContain('10:30');
    expect(times).not.toContain('11:00');
    expect(times).not.toContain('12:00');
    expect(times).toContain('12:30');
    for (const slot of result.slots) expect(Object.keys(slot).sort()).toEqual(['date', 'endsAt', 'startsAt', 'time']);
  });

  test('a live hold removes its slot; a stale hold does not and is expired', async () => {
    const { world, deps } = userWorld();
    const live = makeDoc({ _id: oid(), userId: oid(), status: 'pending_payment', holdExpiresAt: new Date(NOW.getTime() + 600000), startsAt: new Date('2026-10-11T09:00:00Z'), endsAt: new Date('2026-10-11T09:30:00Z') }); // 12:00
    const stale = makeDoc({ _id: oid(), userId: oid(), status: 'pending_payment', holdExpiresAt: new Date(NOW.getTime() - 1000), startsAt: new Date('2026-10-11T09:30:00Z'), endsAt: new Date('2026-10-11T10:00:00Z') }); // 12:30
    world.store.push(live, stale);
    const times = (await listSlots({ from: '2026-10-11', to: '2026-10-11' }, deps)).slots.map(s => s.time);
    expect(times).not.toContain('12:00');
    expect(times).toContain('12:30');
    expect(stale.status).toBe('expired');
    expect(live.status).toBe('pending_payment');
  });

  test('calendar failure -> calendar_unavailable', async () => {
    const { world, deps } = userWorld();
    world.calendar.getBusy.mockRejectedValue(new FakeCalendarError());
    expect(await listSlots({ from: '2026-10-11', to: '2026-10-11' }, deps)).toEqual({ ok: false, code: 'calendar_unavailable' });
  });
});

// ---------------------------------------------------------------------------------------------
describe('listMine', () => {
  const booking = (userId, iso, status = 'confirmed') => makeDoc({
    _id: oid(), userId, status, note: '', startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 30 * 60000),
  });

  test('upcoming is the next confirmed booking in public shape; cancelled and other users never show', async () => {
    const { world, userId, deps } = userWorld();
    world.store.push(
      booking(userId, '2026-10-20T07:00:00Z'),
      booking(userId, '2026-10-25T08:00:00Z', 'cancelled'),
      booking(oid(), '2026-10-09T07:00:00Z'),
    );
    const { upcoming, past } = await listMine(userId, deps);
    expect(Object.keys(upcoming).sort()).toEqual(['checkoutUrl', 'date', 'endsAt', 'holdExpiresAt', 'id', 'note', 'startsAt', 'status', 'time']);
    expect(upcoming).toMatchObject({ date: '2026-10-20', time: '10:00', status: 'confirmed', holdExpiresAt: null, checkoutUrl: null });
    expect(past).toEqual([]);
  });

  test('upcoming is the live hold (with a checkout link) when there is one, even if a confirmed booking is sooner', async () => {
    const { world, userId, deps } = userWorld();
    const holdRow = booking(userId, '2026-10-22T07:00:00Z', 'pending_payment');
    holdRow.holdExpiresAt = new Date(NOW.getTime() + 600000);
    world.store.push(holdRow, booking(userId, '2026-10-20T07:00:00Z'));
    const { upcoming } = await listMine(userId, deps);
    expect(upcoming).toMatchObject({ id: String(holdRow._id), status: 'pending_payment', holdExpiresAt: isoOf(holdRow.holdExpiresAt) });
    expect(upcoming.checkoutUrl).toContain('https://shop.test/cart/12345:1?');
    expect(upcoming.checkoutUrl).toContain(`${encodeURIComponent('attributes[getpretty_booking]')}=${holdRow._id}`);
  });

  test('a stale hold is expired and not shown; the next confirmed booking is', async () => {
    const { world, userId, deps } = userWorld();
    const stale = booking(userId, '2026-10-22T07:00:00Z', 'pending_payment');
    stale.holdExpiresAt = new Date(NOW.getTime() - 1000);
    world.store.push(stale, booking(userId, '2026-10-20T07:00:00Z'));
    const { upcoming } = await listMine(userId, deps);
    expect(upcoming).toMatchObject({ status: 'confirmed', checkoutUrl: null });
    expect(stale.status).toBe('expired');
  });

  test('a stale hold alone -> upcoming is null', async () => {
    const { world, userId, deps } = userWorld();
    const stale = booking(userId, '2026-10-22T07:00:00Z', 'pending_payment');
    stale.holdExpiresAt = new Date(NOW.getTime() - 1000);
    world.store.push(stale);
    expect((await listMine(userId, deps)).upcoming).toBeNull();
  });

  test('nothing upcoming -> upcoming is null', async () => {
    const { userId, deps } = userWorld();
    expect(await listMine(userId, deps)).toEqual({ upcoming: null, past: [] });
  });

  test('past = confirmed bookings that already started, newest first, at most 20', async () => {
    const { world, userId, deps } = userWorld();
    for (let day = 1; day <= 25; day += 1) world.store.push(booking(userId, `2026-09-${String(day).padStart(2, '0')}T07:00:00Z`));
    world.store.push(booking(userId, '2026-09-10T08:00:00Z', 'cancelled'));
    world.store.push(booking(userId, '2026-10-07T06:00:00Z')); // starts exactly now -> counts as past (startsAt <= now)
    const { past } = await listMine(userId, deps);
    expect(past).toHaveLength(20);
    expect(isoOf(past[0].startsAt)).toBe('2026-10-07T06:00:00.000Z');
    expect(isoOf(past[1].startsAt)).toBe('2026-09-25T07:00:00.000Z');
    expect(past.every(b => b.status === 'confirmed')).toBe(true);
    const starts = past.map(b => Date.parse(b.startsAt));
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
  });
});

// ---------------------------------------------------------------------------------------------
describe('admin lists', () => {
  function adminWorld() {
    const ann = oid();
    const bob = oid();
    const mk = (userId, iso, status = 'confirmed', extra = {}) => ({
      userId, status, startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 30 * 60000), note: '', ...extra,
    });
    const world = makeWorld({
      users: [{ _id: ann, email: 'ann@x.com', firstName: 'Ann' }, { _id: bob, email: 'bob@x.com', firstName: 'Bob' }],
      bookings: [
        mk(ann, '2026-10-09T07:00:00Z', 'confirmed', { note: 'later' }),
        mk(bob, '2026-10-08T07:00:00Z'),
        mk(ann, '2026-10-01T07:00:00Z'),
        mk(bob, '2026-09-30T07:00:00Z'),
        mk(ann, '2026-10-15T07:00:00Z', 'cancelled', { cancelledAt: new Date('2026-10-06T10:00:00Z'), cancelledByAdminEmail: 'admin@x.com' }),
        mk(bob, '2026-10-16T07:00:00Z', 'cancelled', { cancelledAt: new Date('2026-10-06T11:00:00Z'), cancelledByAdminEmail: 'admin@x.com' }),
        // Paid-booking rows: a live hold, a stale hold (expired by the sweep) and a paid row that needs attention.
        mk(bob, '2026-10-12T07:00:00Z', 'pending_payment', { holdExpiresAt: new Date('2026-10-07T06:10:00Z'), payment: { status: 'awaiting' } }),
        mk(ann, '2026-10-17T07:00:00Z', 'pending_payment', { holdExpiresAt: new Date('2026-10-07T05:50:00Z'), payment: { status: 'awaiting' } }),
        mk(bob, '2026-10-18T07:00:00Z', 'expired', {
          needsAttention: 'paid_slot_lost',
          payment: { status: 'paid', amount: 150, currency: 'ILS', providerRef: '9001', paidAt: new Date('2026-10-07T05:59:00Z') },
        }),
      ],
    });
    return { world, ann, bob, deps: world.deps };
  }
  const dates = rows => rows.map(r => isoOf(r.startsAt));

  test('upcoming: confirmed in the future plus live holds, soonest first, with the user columns', async () => {
    const { deps, ann } = adminWorld();
    const rows = await listForAdmin({ tab: 'upcoming' }, deps);
    expect(dates(rows)).toEqual(['2026-10-08T07:00:00.000Z', '2026-10-09T07:00:00.000Z', '2026-10-12T07:00:00.000Z']);
    expect(rows[2]).toMatchObject({ status: 'pending_payment', holdExpiresAt: '2026-10-07T06:10:00.000Z', payment: { status: 'awaiting' } });
    expect(Object.keys(rows[1]).sort()).toEqual([
      'calendarSynced', 'cancelledAt', 'cancelledByAdminEmail', 'date', 'endsAt', 'holdExpiresAt', 'id', 'needsAttention', 'note',
      'payment', 'startsAt', 'status', 'time', 'userEmail', 'userFirstName', 'userId',
    ]);
    expect(Object.keys(rows[1].payment).sort()).toEqual(['amount', 'currency', 'paidAt', 'providerRef', 'status']);
    expect(rows[1]).toMatchObject({ userEmail: 'ann@x.com', userFirstName: 'Ann', date: '2026-10-09', time: '10:00', note: 'later', status: 'confirmed', cancelledAt: null, cancelledByAdminEmail: null, holdExpiresAt: null, needsAttention: null, calendarSynced: false });
    expect(String(rows[1].userId)).toBe(String(ann));
  });

  test('past: confirmed already started, newest first', async () => {
    const { deps } = adminWorld();
    expect(dates(await listForAdmin({ tab: 'past' }, deps))).toEqual(['2026-10-01T07:00:00.000Z', '2026-09-30T07:00:00.000Z']);
  });

  test('cancelled: cancelled + expired (a stale hold is expired on the way), newest first, with who cancelled it', async () => {
    const { deps } = adminWorld();
    const rows = await listForAdmin({ tab: 'cancelled' }, deps);
    expect(dates(rows)).toEqual(['2026-10-18T07:00:00.000Z', '2026-10-17T07:00:00.000Z', '2026-10-16T07:00:00.000Z', '2026-10-15T07:00:00.000Z']);
    expect(rows.slice(0, 2).map(r => r.status)).toEqual(['expired', 'expired']);
    expect(rows[2]).toMatchObject({ status: 'cancelled', cancelledByAdminEmail: 'admin@x.com' });
    expect(rows[2].cancelledAt).toBeTruthy();
  });

  test('attention: only rows with needsAttention, with the payment fields', async () => {
    const { deps } = adminWorld();
    const rows = await listForAdmin({ tab: 'attention' }, deps);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      needsAttention: 'paid_slot_lost', status: 'expired', calendarSynced: false, holdExpiresAt: null,
      payment: { status: 'paid', amount: 150, currency: 'ILS', providerRef: '9001' },
    });
    expect(rows[0].payment.paidAt).toBeTruthy();
  });

  test('calendarSynced is true once the row has a calendar event id', async () => {
    const { world, deps } = adminWorld();
    world.store.find(b => isoOf(b.startsAt) === '2026-10-08T07:00:00.000Z').calendarEventId = 'evt-1';
    const rows = await listForAdmin({ tab: 'upcoming' }, deps);
    expect(rows[0].calendarSynced).toBe(true);
  });

  test('listForUser: one user, every status, newest first', async () => {
    const { deps, ann } = adminWorld();
    const rows = await listForUser(ann, deps);
    expect(dates(rows)).toEqual(['2026-10-17T07:00:00.000Z', '2026-10-15T07:00:00.000Z', '2026-10-09T07:00:00.000Z', '2026-10-01T07:00:00.000Z']);
    expect(rows.map(r => r.status)).toEqual(['pending_payment', 'cancelled', 'confirmed', 'confirmed']);
  });

  test('expireHolds flips only pending rows whose hold ran out', async () => {
    const { world, deps } = adminWorld();
    await expireHolds(deps);
    const byStart = iso => world.store.find(b => isoOf(b.startsAt) === iso).status;
    expect(byStart('2026-10-12T07:00:00.000Z')).toBe('pending_payment'); // live
    expect(byStart('2026-10-17T07:00:00.000Z')).toBe('expired'); // stale
    expect(byStart('2026-10-09T07:00:00.000Z')).toBe('confirmed');
  });
});

// ---------------------------------------------------------------------------------------------
describe('cancelBooking', () => {
  function cancelWorld(over = {}) {
    const userId = oid();
    const world = makeWorld({
      users: [{ _id: userId, email: 'dana@example.com', firstName: 'Dana' }],
      bookings: [{ userId, startsAt: new Date(SLOT), endsAt: new Date('2026-10-08T07:30:00Z'), calendarEventId: 'evt-9', ...over }],
    });
    return { world, deps: world.deps, booking: world.store[0] };
  }

  test('deletes the calendar event FIRST, then marks the booking cancelled', async () => {
    const { world, deps, booking } = cancelWorld({ calendarId: 'old-cal@group.calendar.google.com' }); // L8: the stored snapshot is used
    let statusWhenCalendarWasCalled = null;
    world.calendar.deleteEvent.mockImplementation(async () => { statusWhenCalendarWasCalled = booking.status; });
    const result = await cancelBooking(String(booking._id), 'admin@example.com', deps);
    expect(result.ok).toBe(true);
    expect(world.calendar.deleteEvent).toHaveBeenCalledWith('evt-9', 'old-cal@group.calendar.google.com');
    expect(statusWhenCalendarWasCalled).toBe('confirmed'); // the DB was still untouched when the calendar was called
    expect(booking.status).toBe('cancelled');
    expect(booking.cancelledByAdminEmail).toBe('admin@example.com');
    expect(new Date(booking.cancelledAt).getTime()).toBe(NOW.getTime());
  });

  test('a failed calendar delete leaves the booking confirmed; a retry then works', async () => {
    const { world, deps, booking } = cancelWorld();
    world.calendar.deleteEvent.mockRejectedValueOnce(new FakeCalendarError());
    expect(await cancelBooking(String(booking._id), 'admin@example.com', deps)).toEqual({ ok: false, code: 'calendar_unavailable' });
    expect(booking.status).toBe('confirmed');
    expect(booking.cancelledAt).toBeNull();

    // deleteEvent is idempotent, so simply asking again is safe.
    expect((await cancelBooking(String(booking._id), 'admin@example.com', deps)).ok).toBe(true);
    expect(booking.status).toBe('cancelled');
    expect(world.calendar.deleteEvent).toHaveBeenCalledTimes(2);
  });

  test('a booking without an event id (null) skips the calendar and is still cancelled', async () => {
    const { world, deps, booking } = cancelWorld({ calendarEventId: null });
    expect((await cancelBooking(String(booking._id), 'admin@example.com', deps)).ok).toBe(true);
    expect(world.calendar.deleteEvent).not.toHaveBeenCalled();
    expect(booking.status).toBe('cancelled');
  });

  test.each(['cancelled', 'expired'])('a %s booking -> already_cancelled, calendar not touched', async status => {
    const { world, deps, booking } = cancelWorld({ status });
    expect(await cancelBooking(String(booking._id), 'admin@example.com', deps)).toEqual({ ok: false, code: 'already_cancelled' });
    expect(world.calendar.deleteEvent).not.toHaveBeenCalled();
  });

  test('a booking waiting for payment can be cancelled: no calendar call, slot freed', async () => {
    const { world, deps, booking } = cancelWorld({
      status: 'pending_payment', calendarEventId: null, holdExpiresAt: new Date(NOW.getTime() + 600000), payment: { status: 'awaiting' },
    });
    const result = await cancelBooking(String(booking._id), 'admin@example.com', deps);
    expect(result.ok).toBe(true);
    expect(world.calendar.deleteEvent).not.toHaveBeenCalled();
    expect(booking.status).toBe('cancelled');
    expect(booking.cancelledByAdminEmail).toBe('admin@example.com');
    const other = oid();
    world.users.push(makeDoc({ _id: other, email: 'o@x.com', firstName: 'O' }));
    expect((await createBooking(other, { startsAt: SLOT }, deps)).ok).toBe(true);
  });

  test('race: the calendar sync writes an event after our read -> that event is deleted too, then cancelled', async () => {
    const { world, deps, booking } = cancelWorld({ calendarEventId: null, calendarId: '' });
        // The first read sees the row without an event; right after it the "sync" stores one.
    world.Booking.findById.mockImplementationOnce(() => {
      const stale = { ...booking };
      booking.calendarEventId = 'evt-late';
      booking.calendarId = 'cal-late';
      return { lean: () => Promise.resolve(stale) };
    });
    const result = await cancelBooking(String(booking._id), 'admin@example.com', deps);
    expect(result.ok).toBe(true);
    expect(world.calendar.deleteEvent).toHaveBeenCalledWith('evt-late', 'cal-late');
    expect(booking.status).toBe('cancelled');
  });

  test('race: the late event cannot be deleted -> calendar_unavailable and the booking stays', async () => {
    const { world, deps, booking } = cancelWorld({ calendarEventId: null });
    world.Booking.findById.mockImplementationOnce(() => {
      const stale = { ...booking };
      booking.calendarEventId = 'evt-late';
      return { lean: () => Promise.resolve(stale) };
    });
    world.calendar.deleteEvent.mockRejectedValueOnce(new FakeCalendarError());
    expect(await cancelBooking(String(booking._id), 'admin@example.com', deps)).toEqual({ ok: false, code: 'calendar_unavailable' });
    expect(booking.status).toBe('confirmed');
  });

  // Round-2 review N4: the admin cancels what they saw as an unpaid hold, but the Shopify payment
  // confirms it at the same moment. The paid booking must NOT be cancelled silently.
  test('race: a hold is paid while the admin cancels it -> booking_changed, the paid booking stays', async () => {
    const { world, deps, booking } = cancelWorld({
      status: 'pending_payment', calendarEventId: null, holdExpiresAt: new Date(NOW.getTime() + 600000), payment: { status: 'awaiting' },
    });
    world.Booking.findById.mockImplementationOnce(() => {
      const stale = { ...booking };
      booking.status = 'confirmed'; // the webhook confirmed it right after our read
      booking.payment = { status: 'paid', providerRef: '9001' };
      return { lean: () => Promise.resolve(stale) };
    });
    expect(await cancelBooking(String(booking._id), 'admin@example.com', deps)).toEqual({ ok: false, code: 'booking_changed' });
    expect(booking.status).toBe('confirmed');
    expect(booking.cancelledAt).toBeNull();
    expect(world.calendar.deleteEvent).not.toHaveBeenCalled();
  });

  test.each([['an unknown id', () => String(oid())], ['a malformed id', () => 'not-an-object-id']])('%s -> not_found', async (_label, makeId) => {
    const { world, deps } = cancelWorld();
    expect(await cancelBooking(makeId(), 'admin@example.com', deps)).toEqual({ ok: false, code: 'not_found' });
    expect(world.calendar.deleteEvent).not.toHaveBeenCalled();
  });

  test('cancelling frees the slot: another user can book it afterwards', async () => {
    const { world, deps, booking } = cancelWorld();
    await cancelBooking(String(booking._id), 'admin@example.com', deps);
    const other = oid();
    world.users.push(makeDoc({ _id: other, email: 'o@x.com', firstName: 'O' }));
    world.analyses.push(other);
    expect((await createBooking(other, { startsAt: SLOT }, deps)).ok).toBe(true);
  });
});

describe('markAttentionHandled', () => {
  const flagged = over => ({ userId: oid(), startsAt: new Date(SLOT), status: 'expired', needsAttention: 'paid_slot_lost', ...over });

  test('records who and when, and the row leaves the attention tab', async () => {
    const world = makeWorld({ users: [], bookings: [flagged()] });
    const b = world.store[0];
    expect(await markAttentionHandled(String(b._id), 'admin@example.com', world.deps)).toEqual({ ok: true, userId: b.userId });
    expect(b.attentionHandledByAdminEmail).toBe('admin@example.com');
    expect(new Date(b.attentionHandledAt).getTime()).toBe(NOW.getTime());
    expect(await listForAdmin({ tab: 'attention' }, world.deps)).toHaveLength(0);
  });

  test('a second click, or a row that was never flagged -> not_flagged', async () => {
    const world = makeWorld({ bookings: [flagged(), flagged({ needsAttention: null, startsAt: new Date('2026-10-09T07:00:00Z') })] });
    const [a, plain] = world.store;
    await markAttentionHandled(String(a._id), 'admin@example.com', world.deps);
    expect(await markAttentionHandled(String(a._id), 'other@example.com', world.deps)).toEqual({ ok: false, code: 'not_flagged' });
    expect(a.attentionHandledByAdminEmail).toBe('admin@example.com');
    expect(await markAttentionHandled(String(plain._id), 'admin@example.com', world.deps)).toEqual({ ok: false, code: 'not_flagged' });
  });

  test.each([['unknown', () => String(oid())], ['malformed', () => 'nope']])('%s id -> not_found', async (_l, makeId) => {
    const world = makeWorld({ bookings: [flagged()] });
    expect(await markAttentionHandled(makeId(), 'admin@example.com', world.deps)).toEqual({ ok: false, code: 'not_found' });
  });
});

// ---------------------------------------------------------------------------------------------
describe('updateConfig (form body -> validated settings)', () => {
  // The form body the admin page posts: strings only, checkboxes present only when ticked.
  const baseForm = (over = {}) => ({
    enabled: 'on',
    slotMinutes: '30',
    bufferMinutes: '0',
    leadHours: '12',
    horizonDays: '30',
    day0_enabled: 'on', day0_open: '10:00', day0_close: '18:00',
    day1_enabled: 'on', day1_open: '10:00', day1_close: '18:00',
    day2_enabled: 'on', day2_open: '10:00', day2_close: '18:00',
    day3_enabled: 'on', day3_open: '10:00', day3_close: '18:00',
    day4_enabled: 'on', day4_open: '10:00', day4_close: '18:00',
    day5_open: '', day5_close: '',
    day6_open: '', day6_close: '',
    ...over,
  });
  const fresh = () => makeWorld({ config: DEFAULTS });

  test('the same values as now -> ok and nothing changed', async () => {
    const world = fresh();
    expect(await updateConfig(baseForm(), world.deps)).toEqual({ ok: true, changed: [] });
  });

  test('a changed number is stored as a number and reported by name', async () => {
    const world = fresh();
    expect(await updateConfig(baseForm({ leadHours: '24', slotMinutes: '45', horizonDays: '14', bufferMinutes: '15' }), world.deps))
      .toEqual({ ok: true, changed: expect.arrayContaining(['leadHours', 'slotMinutes', 'horizonDays', 'bufferMinutes']) });
    expect(world.config()).toMatchObject({ leadHours: 24, slotMinutes: 45, horizonDays: 14, bufferMinutes: 15 });
  });

  test('an unticked "enabled" checkbox switches booking off', async () => {
    const world = fresh();
    const { enabled, ...withoutEnabled } = baseForm();
    expect(enabled).toBe('on');
    expect(await updateConfig(withoutEnabled, world.deps)).toEqual({ ok: true, changed: ['enabled'] });
    expect(world.config().enabled).toBe(false);
  });

  test('weekly: an enabled day is added, an unticked day is dropped', async () => {
    const world = fresh();
    const form = baseForm({ day5_enabled: 'on', day5_open: '09:00', day5_close: '13:00' });
    delete form.day0_enabled;
    const result = await updateConfig(form, world.deps);
    expect(result).toEqual({ ok: true, changed: ['weekly'] });
    const weekly = world.config().weekly;
    expect(weekly.map(w => w.day).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(weekly.find(w => w.day === 5)).toMatchObject({ open: '09:00', close: '13:00' });
  });

  test('zero enabled days is allowed (the clinic is simply closed)', async () => {
    const world = fresh();
    const form = baseForm();
    for (let d = 0; d <= 6; d += 1) delete form[`day${d}_enabled`];
    expect(await updateConfig(form, world.deps)).toEqual({ ok: true, changed: ['weekly'] });
    expect(world.config().weekly).toEqual([]);
  });

  test('times of a day that is NOT enabled are ignored, even when garbage', async () => {
    const world = fresh();
    expect((await updateConfig(baseForm({ day6_open: 'zzz', day6_close: '99:99' }), world.deps)).ok).toBe(true);
  });

  test.each([
    ['slot length not in the list', { slotMinutes: '25' }],
    ['slot length not a number', { slotMinutes: 'abc' }],
    ['negative buffer', { bufferMinutes: '-1' }],
    ['buffer over 60', { bufferMinutes: '61' }],
    ['fractional buffer', { bufferMinutes: '1.5' }],
    ['lead over 168 hours', { leadHours: '169' }],
    ['negative lead', { leadHours: '-1' }],
    ['horizon of 0 days', { horizonDays: '0' }],
    ['horizon over 30 days', { horizonDays: '31' }],
    ['empty number', { leadHours: '' }],
    ['open without leading zero', { day0_open: '9:00' }],
    ['open 24:00', { day0_open: '24:00' }],
    ['close with 60 minutes', { day0_close: '17:60' }],
    ['close equal to open', { day0_close: '10:00' }],
    ['close before open', { day0_open: '12:00', day0_close: '11:00' }],
    ['enabled day with no times', { day0_open: '', day0_close: '' }],
  ])('invalid: %s -> {ok:false, code:"invalid"} and nothing is saved', async (_label, patch) => {
    const world = fresh();
    expect(await updateConfig(baseForm(patch), world.deps)).toEqual({ ok: false, code: 'invalid' });
    expect(world.config()).toMatchObject(DEFAULTS);
  });
});

// ---------------------------------------------------------------------------------------------
// Review round 1 fixes (contract section 14)
// ---------------------------------------------------------------------------------------------
const SECRET = 'SUPER-SECRET-PRIVATE-KEY-123';
const USER_EMAIL = 'dana@example.com';
// What the calendar service throws, but carrying things that must NEVER reach the log.
const leakyCalendarError = () => Object.assign(new FakeCalendarError(`boom ${SECRET} ${USER_EMAIL}`), {
  reason: 'notFound', status: 404, cause: new Error(`${SECRET} ${USER_EMAIL}`),
});
const spyLog = () => jest.spyOn(console, 'error').mockImplementation(() => {});
const logged = spy => spy.mock.calls.map(c => c.join(' ')).join('\n');

describe('M-2: failures are logged with codes only', () => {
  test('slots: calendar failure logs the Google reason and status, never the key or the user email', async () => {
    const { world, deps } = userWorld();
    const spy = spyLog();
    world.calendar.getBusy.mockRejectedValue(leakyCalendarError());
    await listSlots({ from: '2026-10-11', to: '2026-10-11' }, deps);
    expect(logged(spy)).toContain('booking: calendar_unavailable');
    expect(logged(spy)).toContain('(Google: notFound, status 404)');
    expect(logged(spy)).not.toContain(SECRET);
    expect(logged(spy)).not.toContain(USER_EMAIL);
  });

  test('create: a step 4 failure and a failed rollback delete are logged without secrets or user data', async () => {
    const { world, userId, deps } = userWorld();
    const spy = spyLog();
    world.calendar.getBusy.mockRejectedValueOnce(leakyCalendarError());
    await createBooking(userId, { startsAt: SLOT, note: 'private note' }, deps);
    expect(logged(spy)).toContain('(Google: notFound, status 404)');

    // Race rollback whose row removal fails: only the error NAME is logged, never its message.
    spy.mockClear();
    world.calendar.getBusy.mockImplementationOnce(async () => {
      world.store.push(makeDoc({ _id: oid(), userId, status: 'confirmed', startsAt: new Date('2026-10-09T07:00:00Z'), endsAt: new Date('2026-10-09T07:30:00Z') }));
      return [];
    });
    world.Booking.deleteOne.mockRejectedValueOnce(new Error(`mongo ${USER_EMAIL}`));
    await createBooking(userId, { startsAt: SLOT, note: 'private note' }, deps);
    for (const text of [SECRET, USER_EMAIL, 'private note']) expect(logged(spy)).not.toContain(text);
  });

  test('cancel failure logs the booking id and event id with the Google reason, nothing else', async () => {
    const userId = oid();
    const world = makeWorld({
      users: [{ _id: userId, email: USER_EMAIL, firstName: 'Dana' }],
      bookings: [{ userId, startsAt: new Date(SLOT), endsAt: new Date('2026-10-08T07:30:00Z'), calendarEventId: 'evt-77' }],
    });
    const spy = spyLog();
    world.calendar.deleteEvent.mockRejectedValueOnce(leakyCalendarError());
    await cancelBooking(String(world.store[0]._id), 'admin@example.com', world.deps);
    expect(logged(spy)).toContain(String(world.store[0]._id));
    expect(logged(spy)).toContain('evt-77');
    expect(logged(spy)).toContain('(Google: notFound, status 404)');
    expect(logged(spy)).not.toContain(SECRET);
    expect(logged(spy)).not.toContain(USER_EMAIL);
  });

  const BOOT_ENV = ['BOOKING_ENABLED', 'GOOGLE_CALENDAR_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON_B64'];
  let bootSaved;
  beforeEach(() => { bootSaved = {}; BOOT_ENV.forEach(k => { bootSaved[k] = process.env[k]; }); });
  afterEach(() => {
    BOOT_ENV.forEach(k => { if (bootSaved[k] === undefined) delete process.env[k]; else process.env[k] = bootSaved[k]; });
  });

  test('bookingBootLine: names the missing settings (never values), or says booking is enabled', () => {
    const { world } = userWorld();
    const deps = world.deps;
    // Env vars this test changes are put back afterwards (see afterEach below).
    delete process.env.BOOKING_ENABLED;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
    process.env.GOOGLE_CALENDAR_ID = 'calendar-id-value-must-not-print';
    world.calendar.isConfigured.mockReturnValue(false);
    const line = bookingBootLine(deps);
    expect(line).toBe('booking disabled: missing BOOKING_ENABLED (must be 1), GOOGLE_SERVICE_ACCOUNT_JSON_B64');
    expect(line).not.toContain('calendar-id-value-must-not-print');

    process.env.BOOKING_ENABLED = '1';
    world.calendar.isConfigured.mockReturnValue(true);
    expect(bookingBootLine(deps)).toBe('booking enabled (Google calendar)');

    // Missing Shopify settings are named too (names only, never values).
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    process.env.SHOPIFY_STORE_URL = '';
    const shopLine = bookingBootLine(deps);
    expect(shopLine).toBe('booking disabled: missing SHOPIFY_STORE_URL, SHOPIFY_WEBHOOK_SECRET');
    expect(shopLine).not.toContain('12345');
  });
});

describe('L4: admin lists are capped at 500 rows per tab', () => {
  function bigWorld(count, make) {
    const userId = oid();
    const bookings = Array.from({ length: count }, (_, i) => make(userId, i));
    const world = makeWorld({ users: [{ _id: userId, email: 'a@x.com', firstName: 'A' }], bookings });
    return { world, userId, deps: world.deps };
  }
  const day = n => new Date(NOW.getTime() + n * 24 * 3600 * 1000);
  const row = (userId, startsAt, status = 'confirmed') => ({ userId, status, startsAt, endsAt: new Date(startsAt.getTime() + 1800000) });

  test('upcoming keeps the SOONEST 500', async () => {
    const { deps } = bigWorld(505, (u, i) => row(u, day(i + 1)));
    const rows = await listForAdmin({ tab: 'upcoming' }, deps);
    expect(rows).toHaveLength(500);
    expect(rows[0].startsAt).toBe(day(1).toISOString());
    expect(rows[499].startsAt).toBe(day(500).toISOString());
  });

  test('past and cancelled keep the NEWEST 500', async () => {
    const past = bigWorld(505, (u, i) => row(u, day(-(i + 1))));
    let rows = await listForAdmin({ tab: 'past' }, past.deps);
    expect(rows).toHaveLength(500);
    expect(rows[0].startsAt).toBe(day(-1).toISOString());
    const cancelled = bigWorld(505, (u, i) => row(u, day(i + 1), 'cancelled'));
    rows = await listForAdmin({ tab: 'cancelled' }, cancelled.deps);
    expect(rows).toHaveLength(500);
    expect(rows[0].startsAt).toBe(day(505).toISOString());
  });

  test('the user card is capped too, newest first', async () => {
    const { deps, userId } = bigWorld(505, (u, i) => row(u, day(-i)));
    const rows = await listForUser(userId, deps);
    expect(rows).toHaveLength(500);
    expect(rows[0].startsAt).toBe(day(0).toISOString());
  });
});

describe('L6: same-user race keeps exactly one booking (the earlier one)', () => {
  test('two simultaneous requests of one user: one books, the other gets limit_reached, one row remains', async () => {
    const { world, userId, deps } = userWorld();
    // Hold both requests at the calendar check so they BOTH pass step 2 (no booking exists yet).
    let arrived = 0;
    let open;
    const gate = new Promise(resolve => { open = resolve; });
    world.calendar.getBusy.mockImplementation(async () => {
      arrived += 1;
      if (arrived === 2) open();
      await gate;
      return [];
    });
    const [a, b] = await Promise.all([
      createBooking(userId, { startsAt: SLOT }, deps),
      createBooking(userId, { startsAt: '2026-10-08T07:30:00.000Z' }, deps),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find(r => !r.ok)).toEqual({ ok: false, code: 'limit_reached' });
    expect(world.store).toHaveLength(1); // the user keeps exactly one booking
    // The survivor is the one created FIRST (smallest _id).
    const created = await Promise.all(world.Booking.create.mock.results.map(r => r.value));
    const first = created.map(c => String(c._id)).sort()[0];
    expect(String(world.store[0]._id)).toBe(first);
  });
});

describe('L8: release on account deletion uses the stored calendar and logs ids', () => {
  test('deleteEvent gets the booking snapshot calendarId; a failure logs booking id + event id only', async () => {
    const userId = oid();
    const world = makeWorld({
      users: [{ _id: userId, email: USER_EMAIL, firstName: 'Dana' }],
      bookings: [{ userId, startsAt: new Date(SLOT), endsAt: new Date('2026-10-08T07:30:00Z'), calendarEventId: 'evt-5', calendarId: 'old@group.calendar.google.com' }],
    });
    const spy = spyLog();
    world.calendar.deleteEvent.mockRejectedValueOnce(leakyCalendarError());
    await releaseUserBookings(userId, world.deps);
    expect(world.calendar.deleteEvent).toHaveBeenCalledWith('evt-5', 'old@group.calendar.google.com');
    expect(logged(spy)).toContain(String(world.store[0]._id));
    expect(logged(spy)).toContain('evt-5');
    expect(logged(spy)).not.toContain(SECRET);
    expect(logged(spy)).not.toContain(USER_EMAIL);
  });
});

describe('N-6e: a from-only range past the window has no slots', () => {
  test('from far beyond now + horizonDays (no to) -> ok with zero slots, not invalid_range', async () => {
    const { deps } = userWorld();
    // Window ends about 2026-11-06; the default `to` would be earlier than `from` without the clamp.
    const result = await listSlots({ from: '2027-01-15' }, deps);
    expect(result.ok).toBe(true);
    expect(result.slots).toEqual([]);
  });
});

describe('L9: default slot range ends on the last day the window reaches', () => {
  test('with every weekday open, slots on the local date of now + horizonDays are offered', async () => {
    const allDays = { ...DEFAULTS, weekly: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open: '10:00', close: '18:00' })) };
    const world = makeWorld({ config: allDays });
    // Now = Wed 2026-10-07 15:00 local (12:00Z). Window ends Fri 2026-11-06 14:00 local (12:00Z, UTC+2 after DST ends).
    const deps = { ...world.deps, now: () => new Date('2026-10-07T12:00:00Z') };
    const result = await listSlots({}, deps);
    const last = result.slots[result.slots.length - 1];
    expect(last.date).toBe('2026-11-06');
    expect(last.time).toBe('13:30'); // 13:30 starts before 14:00; 14:00 and later are past the horizon
  });
});
