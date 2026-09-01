const jwt = require('jsonwebtoken');
const { isAllowed, signSession, verifySession, requireAdmin, COOKIE_NAME } = require('./adminAuth');

const OLD_ENV = process.env;
beforeEach(() => {
  process.env = {
    ...OLD_ENV,
    JWT_SECRET: 'test-secret',
    ADMIN_ALLOWED_EMAILS: 'dzaturansky@gmail.com, lutreat@gmail.com',
  };
});
afterEach(() => { process.env = OLD_ENV; });

describe('isAllowed', () => {
  test('accepts allow-listed emails case-insensitively', () => {
    expect(isAllowed('dzaturansky@gmail.com')).toBe(true);
    expect(isAllowed('  Lutreat@Gmail.com ')).toBe(true);
  });
  test('rejects everything else', () => {
    expect(isAllowed('someone@gmail.com')).toBe(false);
    expect(isAllowed('')).toBe(false);
    expect(isAllowed(undefined)).toBe(false);
  });
});

describe('session round-trip', () => {
  test('signSession -> verifySession returns the admin payload', () => {
    const session = verifySession(signSession('dzaturansky@gmail.com'));
    expect(session).toMatchObject({ email: 'dzaturansky@gmail.com', scope: 'admin' });
  });

  test('rejects a token signed with a different secret', () => {
    const foreign = jwt.sign({ email: 'dzaturansky@gmail.com', scope: 'admin' }, 'other-secret');
    expect(verifySession(foreign)).toBeNull();
  });

  test('rejects a valid token whose email is no longer allow-listed', () => {
    const token = signSession('lutreat@gmail.com');
    process.env.ADMIN_ALLOWED_EMAILS = 'dzaturansky@gmail.com';
    expect(verifySession(token)).toBeNull();
  });

  test('rejects a non-admin scope', () => {
    const token = jwt.sign({ email: 'dzaturansky@gmail.com', scope: 'user' }, 'test-secret');
    expect(verifySession(token)).toBeNull();
  });
});

describe('requireAdmin middleware', () => {
  test('redirects to /admin/login without a valid cookie', () => {
    const redirect = jest.fn();
    const next = jest.fn();
    requireAdmin({ cookies: {} }, { redirect }, next);
    expect(redirect).toHaveBeenCalledWith('/admin/login');
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next and attaches req.admin with a valid cookie', () => {
    const req = { cookies: { [COOKIE_NAME]: signSession('dzaturansky@gmail.com') } };
    const next = jest.fn();
    requireAdmin(req, { redirect: jest.fn() }, next);
    expect(next).toHaveBeenCalled();
    expect(req.admin.email).toBe('dzaturansky@gmail.com');
  });
});
