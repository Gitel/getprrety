jest.mock('./rateLimit');

const { consumeRateLimit } = require('./rateLimit');
const { allowAuthAttempt, releaseAuthAttempt } = require('./authRateLimit');

const OLD_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV, JWT_SECRET: 'test-secret' };
});

afterAll(() => {
  process.env = OLD_ENV;
});

const req = (ip = '203.0.113.7') => ({ ip });

test('passes the attempt through to the rate limiter and returns its verdict', async () => {
  consumeRateLimit.mockResolvedValue(true);
  await expect(allowAuthAttempt(req(), 'login')).resolves.toBe(true);

  consumeRateLimit.mockResolvedValue(false);
  await expect(allowAuthAttempt(req(), 'login')).resolves.toBe(false);
});

test('uses a distinct scope and window per endpoint kind', async () => {
  consumeRateLimit.mockResolvedValue(true);

  await allowAuthAttempt(req(), 'login');
  await allowAuthAttempt(req(), 'signup');
  await allowAuthAttempt(req(), 'google');

  const scopes = consumeRateLimit.mock.calls.map(c => c[0]);
  expect(scopes).toEqual(['auth_login', 'auth_signup', 'auth_google']);
  // login/google are 15-minute windows, signup is hourly
  expect(consumeRateLimit.mock.calls[0][3]).toBe(15 * 60 * 1000);
  expect(consumeRateLimit.mock.calls[1][3]).toBe(60 * 60 * 1000);
  expect(consumeRateLimit.mock.calls[2][3]).toBe(15 * 60 * 1000);
});

test('hashes the IP rather than passing it raw', async () => {
  consumeRateLimit.mockResolvedValue(true);
  await allowAuthAttempt(req('198.51.100.9'), 'login');

  const keyArg = consumeRateLimit.mock.calls[0][1];
  expect(keyArg).toMatch(/^[a-f0-9]{64}$/);
  expect(keyArg).not.toContain('198.51.100.9');
});

test('same IP hashes stably, different IPs differ', async () => {
  consumeRateLimit.mockResolvedValue(true);
  await allowAuthAttempt(req('198.51.100.9'), 'login');
  await allowAuthAttempt(req('198.51.100.9'), 'login');
  await allowAuthAttempt(req('198.51.100.10'), 'login');

  const [a, b, c] = consumeRateLimit.mock.calls.map(call => call[1]);
  expect(a).toBe(b);
  expect(a).not.toBe(c);
});

test('throws when JWT_SECRET is missing', async () => {
  delete process.env.JWT_SECRET;
  await expect(allowAuthAttempt(req(), 'login')).rejects.toThrow('JWT_SECRET');
});

test('rejects an unknown kind', async () => {
  await expect(allowAuthAttempt(req(), 'nope')).rejects.toThrow('Unknown auth rate-limit kind');
});

test('releasing a successful attempt refunds the unit it consumed', async () => {
  const { refundRateLimit } = require('./rateLimit');
  await releaseAuthAttempt(req('203.0.113.7'), 'signup');

  expect(refundRateLimit).toHaveBeenCalledTimes(1);
  const [scope, key, windowMs] = refundRateLimit.mock.calls[0];
  expect(scope).toBe('auth_signup');
  expect(windowMs).toBe(60 * 60 * 1000);
  expect(key).toMatch(/^[a-f0-9]{64}$/);
});

test('the refund lands on the same bucket the attempt consumed', async () => {
  const { consumeRateLimit, refundRateLimit } = require('./rateLimit');
  consumeRateLimit.mockResolvedValue(true);

  await allowAuthAttempt(req('198.51.100.9'), 'login');
  await releaseAuthAttempt(req('198.51.100.9'), 'login');

  expect(refundRateLimit.mock.calls[0][0]).toBe(consumeRateLimit.mock.calls[0][0]);
  expect(refundRateLimit.mock.calls[0][1]).toBe(consumeRateLimit.mock.calls[0][1]);
  expect(refundRateLimit.mock.calls[0][2]).toBe(consumeRateLimit.mock.calls[0][3]);
});

test('releasing an unknown kind throws', async () => {
  await expect(releaseAuthAttempt(req(), 'nope')).rejects.toThrow('Unknown auth rate-limit kind');
});
