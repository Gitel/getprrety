// Handler-level tests (no supertest, no DB, no network): we pull each route handler out of
// the express router and call it with a fake req/res and mocked models.
process.env.JWT_SECRET = 'test-secret';

jest.mock('../models/User', () => ({
  findOne: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), create: jest.fn(),
}));
jest.mock('../services/authRateLimit', () => ({
  allowAuthAttempt: jest.fn(), releaseAuthAttempt: jest.fn().mockResolvedValue(),
}));

const User = require('../models/User');
const { allowAuthAttempt } = require('../services/authRateLimit');
const requireAuth = require('../middleware/auth');
const authRouter = require('./auth');
const profileRouter = require('./profile');

// Returns the last (real) handler of a route, skipping the requireAuth middleware.
function handler(router, method, path) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function fakeRes() {
  const res = { statusCode: 200 };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; return res; };
  return res;
}

beforeEach(() => {
  jest.resetAllMocks();
  allowAuthAttempt.mockResolvedValue(true);
  require('../services/authRateLimit').releaseAuthAttempt.mockResolvedValue();
  process.env.CONSENT_VERSION = '2026-09';
});

describe('auth routes carry error codes', () => {
  const signup = handler(authRouter, 'post', '/signup');
  const login = handler(authRouter, 'post', '/login');
  const goodConsent = () => ({ consentAcceptedAt: new Date().toISOString(), consentVersion: '2026-09' });

  test('rate limit', async () => {
    allowAuthAttempt.mockResolvedValue(false);
    const res = fakeRes();
    await login({ body: {} }, res);
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('too_many_attempts');
    expect(res.body.error).toMatch(/Too many attempts/);
  });

  test('signup missing fields, short password, bad email', async () => {
    let res = fakeRes();
    await signup({ body: {} }, res);
    expect(res.body).toEqual({ error: 'Email and password are required', code: 'email_password_required' });

    res = fakeRes();
    await signup({ body: { email: 'a@b.co', password: 'short' } }, res);
    expect(res.body).toEqual({ error: 'Password must be at least 8 characters', code: 'password_too_short', params: { min: 8 } });

    res = fakeRes();
    await signup({ body: { email: 'nope', password: 'longenough', ...goodConsent() } }, res);
    expect(res.body).toEqual({ error: 'Enter a valid email address', code: 'invalid_email' });
  });

  test('signup forwards the consent code', async () => {
    const res = fakeRes();
    await signup({ body: { email: 'a@b.co', password: 'longenough' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Terms and privacy consent is required', code: 'consent_required' });
  });

  test('signup existing email and unexpected failure', async () => {
    const body = { email: 'a@b.co', password: 'longenough', ...goodConsent() };
    User.findOne.mockResolvedValue({ _id: 1 });
    let res = fakeRes();
    await signup({ body }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Email already registered', code: 'email_taken' });

    User.findOne.mockRejectedValue(new Error('boom'));
    res = fakeRes();
    await signup({ body }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Unable to create account', code: 'signup_failed' });
  });

  test('google: missing token, unavailable, invalid token', async () => {
    const google = handler(authRouter, 'post', '/google');
    let res = fakeRes();
    await google({ body: {} }, res);
    expect(res.body).toEqual({ error: 'idToken is required', code: 'google_token_required' });

    delete process.env.GOOGLE_CLIENT_IDS;
    res = fakeRes();
    await google({ body: { idToken: 'x' } }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'Google sign-in is temporarily unavailable', code: 'google_unavailable' });

    // A garbage token makes the real verifier throw (no network is needed to reject it).
    process.env.GOOGLE_CLIENT_IDS = 'client-id';
    res = fakeRes();
    await google({ body: { idToken: 'garbage' } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid Google sign-in token', code: 'google_token_invalid' });
    delete process.env.GOOGLE_CLIENT_IDS;
  });

  test('login: missing fields, bad credentials, failure', async () => {
    let res = fakeRes();
    await login({ body: {} }, res);
    expect(res.body.code).toBe('email_password_required');

    User.findOne.mockResolvedValue(null);
    res = fakeRes();
    await login({ body: { email: 'a@b.co', password: 'pw' } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password', code: 'invalid_credentials' });

    User.findOne.mockRejectedValue(new Error('boom'));
    res = fakeRes();
    await login({ body: { email: 'a@b.co', password: 'pw' } }, res);
    expect(res.body).toEqual({ error: 'Unable to log in', code: 'login_failed' });
  });

  test('me: not found and failure', async () => {
    const me = handler(authRouter, 'get', '/me');
    User.findById.mockReturnValue({ select: () => Promise.resolve(null) });
    let res = fakeRes();
    await me({ user: { id: 1 } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'User not found', code: 'user_not_found' });

    User.findById.mockImplementation(() => { throw new Error('boom'); });
    res = fakeRes();
    await me({ user: { id: 1 } }, res);
    expect(res.body).toEqual({ error: 'Unable to load account', code: 'account_load_failed' });
  });

  test('toPublicUser (via login) includes language, null when unset', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('password1', 4);
    User.findOne.mockResolvedValue({ _id: 1, email: 'a@b.co', passwordHash: hash });
    let res = fakeRes();
    await login({ body: { email: 'a@b.co', password: 'password1' } }, res);
    expect(res.body.user.language).toBeNull();

    User.findOne.mockResolvedValue({ _id: 1, email: 'a@b.co', passwordHash: hash, language: 'he' });
    res = fakeRes();
    await login({ body: { email: 'a@b.co', password: 'password1' } }, res);
    expect(res.body.user.language).toBe('he');
  });
});

describe('requireAuth middleware codes', () => {
  test('no token / bad token', () => {
    let res = fakeRes();
    requireAuth({ headers: {} }, res, jest.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'No token provided', code: 'auth_required' });

    res = fakeRes();
    requireAuth({ headers: { authorization: 'Bearer garbage' } }, res, jest.fn());
    expect(res.body).toEqual({ error: 'Invalid or expired token', code: 'auth_invalid' });
  });
});

describe('profile routes', () => {
  const patch = handler(profileRouter, 'patch', '/');
  const get = handler(profileRouter, 'get', '/');

  test.each(['en', 'he', null])('PATCH accepts language %s and passes it to the update', async lang => {
    User.findByIdAndUpdate.mockReturnValue({ select: () => Promise.resolve({ language: lang }) });
    const res = fakeRes();
    await patch({ user: { id: 1 }, body: { language: lang } }, res);
    expect(res.statusCode).toBe(200);
    expect(User.findByIdAndUpdate.mock.calls[0][1]).toEqual({ language: lang });
  });

  test.each(['fr', '', 5])('PATCH rejects language %p with no DB call', async lang => {
    const res = fakeRes();
    await patch({ user: { id: 1 }, body: { language: lang } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Unsupported language', code: 'invalid_language' });
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('PATCH without language is unaffected; failure has a code', async () => {
    User.findByIdAndUpdate.mockReturnValue({ select: () => Promise.resolve({}) });
    let res = fakeRes();
    await patch({ user: { id: 1 }, body: { firstName: 'A' } }, res);
    expect(res.statusCode).toBe(200);

    User.findByIdAndUpdate.mockImplementation(() => { throw new Error('boom'); });
    res = fakeRes();
    await patch({ user: { id: 1 }, body: { firstName: 'A' } }, res);
    expect(res.body).toEqual({ error: 'Unable to update profile', code: 'profile_update_failed' });
  });

  test('GET: not found and failure', async () => {
    User.findById.mockReturnValue({ select: () => Promise.resolve(null) });
    let res = fakeRes();
    await get({ user: { id: 1 } }, res);
    expect(res.body).toEqual({ error: 'User not found', code: 'user_not_found' });

    User.findById.mockImplementation(() => { throw new Error('boom'); });
    res = fakeRes();
    await get({ user: { id: 1 } }, res);
    expect(res.body).toEqual({ error: 'Unable to load profile', code: 'profile_load_failed' });
  });
});

// The booking routes send these codes; the app translates them with src/locales/{en,he}/errors.json.
// This pins that every code has an entry in both languages and that the English text matches the
// server text (see the "New error codes" table in AI/plans/in-app-booking-contract.md).
describe('booking error codes have app translations', () => {
  const fs = require('fs');
  const path = require('path');
  const load = lang => JSON.parse(fs.readFileSync(path.join(__dirname, '../../src/locales', lang, 'errors.json'), 'utf8'));
  const en = load('en');
  const he = load('he');
  const ENGLISH = {
    booking_disabled: 'Booking is not available right now.',
    slot_taken: 'Sorry, that time was just taken. Please choose another.',
    limit_reached: 'You already have an upcoming consultation. To change it, message the clinic.',
    slot_invalid: 'That time is not available. Please choose another.',
    calendar_unavailable: 'We cannot reach the clinic calendar right now. Please try again in a moment.',
    booking_rate_limited: 'Too many requests. Please wait a little and try again.',
    invalid_range: 'Choose a valid range of dates.',
    note_too_long: 'The note can be up to {{max}} characters.',
    booking_load_failed: 'Unable to load bookings',
    booking_failed: 'Unable to book the consultation',
  };

  test.each(Object.entries(ENGLISH))('%s: English text matches and a Hebrew text exists', (code, text) => {
    expect(en[code]).toBe(text);
    expect(typeof he[code]).toBe('string');
    expect(he[code].length).toBeGreaterThan(0);
  });

  test('note_too_long keeps its {{max}} placeholder in Hebrew too', () => {
    expect(he.note_too_long).toContain('{{max}}');
  });
});
