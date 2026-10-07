// Handler-level tests for routes/bookings.js (no supertest, no DB, no network), same idea as
// messages.test.js: pull each route handler out of the express router and call it with a fake
// req/res. The service and the rate limiter are mocked; requireAuth is the REAL middleware so we
// can prove every route is guarded by it.
process.env.JWT_SECRET = 'test-secret';

jest.mock('../services/bookings');
jest.mock('../services/rateLimit', () => ({ consumeRateLimit: jest.fn() }));

const bookings = require('../services/bookings');
const { consumeRateLimit } = require('../services/rateLimit');
const requireAuth = require('../middleware/auth');
const router = require('./bookings');

const findLayer = (method, path) => router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);

// Calls the final handler of a route directly.
async function call(method, path, { body = {}, query = {} } = {}) {
  const handlers = findLayer(method, path).route.stack.map(s => s.handle);
  const req = { body, query, user: { id: 'u1' } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handlers[handlers.length - 1](req, res);
  return res;
}

let errorSpy;
beforeEach(() => {
  jest.resetAllMocks();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  consumeRateLimit.mockResolvedValue(true); // rate limit allows by default
});

afterEach(() => errorSpy.mockRestore());

// M-2: an unexpected failure leaves ONE log line with the route and the error class, nothing else.
describe('unexpected failures are logged safely', () => {
  test.each([
    ['get', '/config', 'getPublicConfig', 'GET /api/bookings/config'],
    ['get', '/slots', 'listSlots', 'GET /api/bookings/slots'],
    ['post', '/', 'createBooking', 'POST /api/bookings'],
    ['get', '/mine', 'listMine', 'GET /api/bookings/mine'],
  ])('%s %s', async (method, path, fn, label) => {
    const secret = 'SECRET-KEY-dana@example.com';
    bookings[fn].mockRejectedValue(new TypeError(`bad data ${secret}`));
    await call(method, path, { body: { startsAt: 'x', note: 'private note' } });
    const text = errorSpy.mock.calls.map(c => c.join(' ')).join(' | ');
    expect(text).toBe(`booking: unexpected error in ${label} (TypeError)`);
    expect(text).not.toContain(secret);
    expect(text).not.toContain('private note');
  });
});

describe('every route is behind requireAuth', () => {
  test.each([
    ['get', '/config'],
    ['get', '/slots'],
    ['post', '/'],
    ['get', '/mine'],
  ])('%s %s uses requireAuth as its first handler', (method, path) => {
    const layer = findLayer(method, path);
    expect(layer).toBeDefined();
    expect(layer.route.stack[0].handle).toBe(requireAuth);
  });

  test('no other route is exposed', () => {
    const routes = router.stack.filter(l => l.route).map(l => `${Object.keys(l.route.methods)[0]} ${l.route.path}`).sort();
    expect(routes).toEqual(['get /config', 'get /mine', 'get /slots', 'post /']);
  });

  test('requireAuth rejects a missing token with the auth_required code', () => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = jest.fn();
    requireAuth({ headers: {} }, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('auth_required');
    expect(next).not.toHaveBeenCalled();
  });
});

describe('GET /api/bookings/config', () => {
  test('200 with the public config, or just {enabled:false}', async () => {
    const config = { enabled: true, slotMinutes: 30, leadHours: 12, horizonDays: 30, timeZone: 'Asia/Jerusalem' };
    bookings.getPublicConfig.mockResolvedValue(config);
    let res = await call('get', '/config');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(config);

    bookings.getPublicConfig.mockResolvedValue({ enabled: false });
    res = await call('get', '/config');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });

  test('unexpected failure -> 500 booking_load_failed', async () => {
    bookings.getPublicConfig.mockRejectedValue(new Error('db down'));
    const res = await call('get', '/config');
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Unable to load bookings', code: 'booking_load_failed' });
  });
});

describe('GET /api/bookings/slots', () => {
  test('200 passes from/to to the service and returns { timeZone, slots }', async () => {
    const slots = [{ startsAt: '2026-10-08T07:00:00.000Z', endsAt: '2026-10-08T07:30:00.000Z', date: '2026-10-08', time: '10:00' }];
    bookings.listSlots.mockResolvedValue({ ok: true, timeZone: 'Asia/Jerusalem', slots });
    const res = await call('get', '/slots', { query: { from: '2026-10-08', to: '2026-10-09' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ timeZone: 'Asia/Jerusalem', slots });
    expect(bookings.listSlots.mock.calls[0][0]).toEqual({ from: '2026-10-08', to: '2026-10-09' });
  });

  test.each([
    ['invalid_range', 400, 'Choose a valid range of dates.'],
    ['booking_disabled', 404, 'Booking is not available right now.'],
    ['calendar_unavailable', 503, 'We cannot reach the clinic calendar right now. Please try again in a moment.'],
  ])('service result %s -> %i with the English text and code', async (code, status, error) => {
    bookings.listSlots.mockResolvedValue({ ok: false, code });
    const res = await call('get', '/slots');
    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual({ error, code });
  });

  test('unexpected failure -> 500 booking_load_failed', async () => {
    bookings.listSlots.mockRejectedValue(new Error('boom'));
    const res = await call('get', '/slots');
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Unable to load bookings', code: 'booking_load_failed' });
  });

  test('rate limit: 120 per hour per user (scope booking_slots) -> 429 before any work', async () => {
    consumeRateLimit.mockResolvedValue(false);
    const res = await call('get', '/slots');
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'Too many requests. Please wait a little and try again.', code: 'booking_rate_limited' });
    expect(consumeRateLimit.mock.calls[0].slice(0, 3)).toEqual(['booking_slots', 'u1', 120]);
    expect(bookings.listSlots).not.toHaveBeenCalled();
  });
});

describe('POST /api/bookings', () => {
  const body = { startsAt: '2026-10-08T07:00:00.000Z', note: 'First visit' };

  test('201 returns { booking, warning } and hands the user id and body to the service', async () => {
    const booking = { id: 'b1', startsAt: body.startsAt, endsAt: '2026-10-08T07:30:00.000Z', date: '2026-10-08', time: '10:00', status: 'confirmed', note: 'First visit' };
    bookings.createBooking.mockResolvedValue({ ok: true, booking, warning: 'no_analysis' });
    const res = await call('post', '/', { body });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ booking, warning: 'no_analysis' });
    expect(bookings.createBooking.mock.calls[0][0]).toBe('u1');
    expect(bookings.createBooking.mock.calls[0][1]).toEqual(body);
  });

  test('201 with warning null when the analysis exists', async () => {
    bookings.createBooking.mockResolvedValue({ ok: true, booking: { id: 'b1' }, warning: null });
    const res = await call('post', '/', { body });
    expect(res.statusCode).toBe(201);
    expect(res.body.warning).toBeNull();
  });

  test.each([
    ['booking_disabled', 404, 'Booking is not available right now.'],
    ['account_not_found', 404, 'Account not found'],
    ['slot_taken', 409, 'Sorry, that time was just taken. Please choose another.'],
    ['limit_reached', 409, 'You already have an upcoming consultation. To change it, message the clinic.'],
    ['slot_invalid', 422, 'That time is not available. Please choose another.'],
    ['calendar_unavailable', 503, 'We cannot reach the clinic calendar right now. Please try again in a moment.'],
    ['booking_failed', 500, 'Unable to book the consultation'],
  ])('service result %s -> %i, English text and code, no params', async (code, status, error) => {
    bookings.createBooking.mockResolvedValue({ ok: false, code });
    const res = await call('post', '/', { body });
    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual({ error, code });
  });

  test('note_too_long -> 400 with the limit (300) both in the text and as params.max', async () => {
    bookings.createBooking.mockResolvedValue({ ok: false, code: 'note_too_long' });
    const res = await call('post', '/', { body });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'The note can be up to 300 characters.', code: 'note_too_long', params: { max: 300 } });
  });

  test('unexpected failure -> 500 booking_failed', async () => {
    bookings.createBooking.mockRejectedValue(new Error('boom'));
    const res = await call('post', '/', { body });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Unable to book the consultation', code: 'booking_failed' });
  });

  test('rate limit: 10 per hour per user (scope booking_create) -> 429 and nothing is booked', async () => {
    consumeRateLimit.mockResolvedValue(false);
    const res = await call('post', '/', { body });
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'Too many requests. Please wait a little and try again.', code: 'booking_rate_limited' });
    expect(consumeRateLimit.mock.calls[0].slice(0, 3)).toEqual(['booking_create', 'u1', 10]);
    expect(bookings.createBooking).not.toHaveBeenCalled();
  });
});

describe('GET /api/bookings/mine', () => {
  test('200 returns { upcoming, past } for the signed-in user', async () => {
    const mine = { upcoming: null, past: [{ id: 'b0' }] };
    bookings.listMine.mockResolvedValue(mine);
    const res = await call('get', '/mine');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(mine);
    expect(bookings.listMine.mock.calls[0][0]).toBe('u1');
  });

  test('unexpected failure -> 500 booking_load_failed', async () => {
    bookings.listMine.mockRejectedValue(new Error('boom'));
    const res = await call('get', '/mine');
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Unable to load bookings', code: 'booking_load_failed' });
  });
});
