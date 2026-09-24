// AdminUser is auto-mocked: these tests never touch MongoDB. Each test decides what
// AdminUser.exists() resolves to, i.e. whether an email was "added from the dashboard".
jest.mock('../models/AdminUser');

const jwt = require('jsonwebtoken');
const AdminUser = require('../models/AdminUser');
const {
  isAllowed, isBuiltInAdmin, signSession, verifySession, requireAdmin, COOKIE_NAME,
} = require('./adminAuth');

const OLD_ENV = process.env;
beforeEach(() => {
  process.env = {
    ...OLD_ENV,
    JWT_SECRET: 'test-secret',
    ADMIN_ALLOWED_EMAILS: 'dzaturansky@gmail.com, lutreat@gmail.com',
  };
  // Default: nobody was added from the dashboard.
  AdminUser.exists.mockReset();
  AdminUser.exists.mockResolvedValue(null);
});
afterEach(() => { process.env = OLD_ENV; });

describe('isBuiltInAdmin', () => {
  test('matches env admins case-insensitively and nothing else', () => {
    expect(isBuiltInAdmin('  Lutreat@Gmail.com ')).toBe(true);
    expect(isBuiltInAdmin('someone@gmail.com')).toBe(false);
    expect(isBuiltInAdmin(undefined)).toBe(false);
  });
});

describe('isAllowed', () => {
  test('accepts allow-listed emails case-insensitively without a DB lookup', async () => {
    await expect(isAllowed('dzaturansky@gmail.com')).resolves.toBe(true);
    await expect(isAllowed('  Lutreat@Gmail.com ')).resolves.toBe(true);
    expect(AdminUser.exists).not.toHaveBeenCalled();
  });

  test('accepts an admin added from the dashboard, looked up normalized', async () => {
    AdminUser.exists.mockResolvedValue({ _id: 'x' });
    await expect(isAllowed('  New.Admin@Example.com ')).resolves.toBe(true);
    expect(AdminUser.exists).toHaveBeenCalledWith({ email: 'new.admin@example.com' });
  });

  test('rejects everything else', async () => {
    await expect(isAllowed('someone@gmail.com')).resolves.toBe(false);
    await expect(isAllowed('')).resolves.toBe(false);
    await expect(isAllowed(undefined)).resolves.toBe(false);
  });

  test('propagates a database error instead of treating it as "not allowed"', async () => {
    AdminUser.exists.mockRejectedValue(new Error('mongo down'));
    await expect(isAllowed('someone@gmail.com')).rejects.toThrow('mongo down');
  });
});

describe('session round-trip', () => {
  test('signSession -> verifySession returns the admin payload', async () => {
    const session = await verifySession(signSession('dzaturansky@gmail.com'));
    expect(session).toMatchObject({ email: 'dzaturansky@gmail.com', scope: 'admin' });
  });

  test('rejects a token signed with a different secret', async () => {
    const foreign = jwt.sign({ email: 'dzaturansky@gmail.com', scope: 'admin' }, 'other-secret');
    await expect(verifySession(foreign)).resolves.toBeNull();
  });

  test('rejects a valid token whose email is no longer allow-listed', async () => {
    const token = signSession('lutreat@gmail.com');
    process.env.ADMIN_ALLOWED_EMAILS = 'dzaturansky@gmail.com';
    await expect(verifySession(token)).resolves.toBeNull();
  });

  test('rejects a dashboard admin once they are removed', async () => {
    AdminUser.exists.mockResolvedValue({ _id: 'x' });
    const token = signSession('helper@example.com');
    await expect(verifySession(token)).resolves.toMatchObject({ email: 'helper@example.com' });
    AdminUser.exists.mockResolvedValue(null); // removed from the Admins page
    await expect(verifySession(token)).resolves.toBeNull();
  });

  test('rejects a non-admin scope', async () => {
    const token = jwt.sign({ email: 'dzaturansky@gmail.com', scope: 'user' }, 'test-secret');
    await expect(verifySession(token)).resolves.toBeNull();
  });
});

describe('requireAdmin middleware', () => {
  test('redirects to /admin/login without a valid cookie', async () => {
    const redirect = jest.fn();
    const next = jest.fn();
    await requireAdmin({ cookies: {} }, { redirect }, next);
    expect(redirect).toHaveBeenCalledWith('/admin/login');
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next and attaches req.admin with a valid cookie', async () => {
    const req = { cookies: { [COOKIE_NAME]: signSession('dzaturansky@gmail.com') } };
    const next = jest.fn();
    await requireAdmin(req, { redirect: jest.fn() }, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.admin.email).toBe('dzaturansky@gmail.com');
  });

  test('passes a database error to next(err) exactly once', async () => {
    AdminUser.exists.mockRejectedValue(new Error('mongo down'));
    const req = { cookies: { [COOKIE_NAME]: signSession('helper@example.com') } };
    const next = jest.fn();
    const redirect = jest.fn();
    await requireAdmin(req, { redirect }, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(redirect).not.toHaveBeenCalled();
  });
});
