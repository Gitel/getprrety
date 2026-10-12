// Handler-level tests for POST /api/auth/link/redeem (no supertest, no DB, no network).
process.env.JWT_SECRET = 'test-secret';

jest.mock('../models/User', () => ({ findOne: jest.fn(), findById: jest.fn(), create: jest.fn() }));
jest.mock('../services/authRateLimit', () => ({
  allowAuthAttempt: jest.fn(), releaseAuthAttempt: jest.fn().mockResolvedValue(),
}));
jest.mock('../services/loginLinks', () => ({ redeem: jest.fn() }));

const jwt = require('jsonwebtoken');
const { allowAuthAttempt } = require('../services/authRateLimit');
const loginLinks = require('../services/loginLinks');
const authRouter = require('./auth');

const layer = authRouter.stack.find(l => l.route && l.route.path === '/link/redeem' && l.route.methods.post);
const redeemRoute = layer.route.stack[layer.route.stack.length - 1].handle;

function fakeRes() {
  const res = { statusCode: 200 };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; return res; };
  return res;
}

const user = { _id: 'u1', email: 'a@b.co', firstName: 'Ada', language: 'he' };

beforeEach(() => {
  jest.resetAllMocks();
  allowAuthAttempt.mockResolvedValue(true);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

test('over the IP limit -> 429 too_many_attempts, and uses the link kind', async () => {
  allowAuthAttempt.mockResolvedValue(false);
  const res = fakeRes();
  await redeemRoute({ body: { token: 't' } }, res);
  expect(res.statusCode).toBe(429);
  expect(res.body.code).toBe('too_many_attempts');
  expect(allowAuthAttempt.mock.calls[0][1]).toBe('link');
  expect(loginLinks.redeem).not.toHaveBeenCalled();
});

test('missing or non-string token -> 400 link_invalid without touching the service', async () => {
  for (const body of [{}, { token: 42 }, { token: '' }, undefined]) {
    const res = fakeRes();
    await redeemRoute({ body }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('link_invalid');
  }
  expect(loginLinks.redeem).not.toHaveBeenCalled();
});

test('existing account -> 200 with a signed JWT, public user and isNew false', async () => {
  loginLinks.redeem.mockResolvedValue({ ok: true, user, isNew: false });
  const res = fakeRes();
  await redeemRoute({ body: { token: 'tok' } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.isNew).toBe(false);
  expect(res.body.user.email).toBe('a@b.co');
  expect(jwt.verify(res.body.token, 'test-secret').id).toBe('u1');
});

test('new invited account -> 201 isNew true', async () => {
  loginLinks.redeem.mockResolvedValue({ ok: true, user, isNew: true });
  const res = fakeRes();
  await redeemRoute({ body: { token: 'tok', consentAcceptedAt: 'x', consentVersion: 'v' } }, res);
  expect(res.statusCode).toBe(201);
  expect(res.body.isNew).toBe(true);
  expect(loginLinks.redeem).toHaveBeenCalledWith({ token: 'tok', consentAcceptedAt: 'x', consentVersion: 'v' });
});

test('non-string consent fields are passed as undefined', async () => {
  loginLinks.redeem.mockResolvedValue({ ok: false, code: 'link_invalid' });
  await redeemRoute({ body: { token: 'tok', consentAcceptedAt: { a: 1 }, consentVersion: 5 } }, fakeRes());
  expect(loginLinks.redeem).toHaveBeenCalledWith({ token: 'tok', consentAcceptedAt: undefined, consentVersion: undefined });
});

test('link_invalid from the service -> 400', async () => {
  loginLinks.redeem.mockResolvedValue({ ok: false, code: 'link_invalid' });
  const res = fakeRes();
  await redeemRoute({ body: { token: 'tok' } }, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.code).toBe('link_invalid');
});

test('consent codes are passed through', async () => {
  for (const code of ['consent_required', 'consent_outdated']) {
    loginLinks.redeem.mockResolvedValue({ ok: false, code, status: 400, error: 'msg' });
    const res = fakeRes();
    await redeemRoute({ body: { token: 'tok' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'msg', code });
  }
});

test('unexpected failure -> 500 signin_link_failed', async () => {
  loginLinks.redeem.mockRejectedValue(new Error('db down'));
  const res = fakeRes();
  await redeemRoute({ body: { token: 'tok' } }, res);
  expect(res.statusCode).toBe(500);
  expect(res.body.code).toBe('signin_link_failed');
});
