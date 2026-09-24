const { addAdmin, removeAdmin } = require('./adminUsers');

const OLD_ENV = process.env;
beforeEach(() => {
  process.env = { ...OLD_ENV, ADMIN_ALLOWED_EMAILS: 'owner@example.com' };
});
afterEach(() => { process.env = OLD_ENV; });

// A stand-in for the AdminUser model: only the methods the service calls.
function fakeModel({ createImpl, found } = {}) {
  return {
    create: jest.fn(createImpl || (async doc => doc)),
    findById: jest.fn(() => ({ lean: async () => found || null })),
    deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
  };
}

describe('addAdmin', () => {
  test('stores the email normalized, with who added it', async () => {
    const model = fakeModel();
    await expect(addAdmin({ email: '  New@Example.COM ', addedBy: 'Owner@Example.com' }, { model }))
      .resolves.toEqual({ ok: true, email: 'new@example.com' });
    expect(model.create).toHaveBeenCalledWith({ email: 'new@example.com', addedBy: 'owner@example.com' });
  });

  test.each(['', 'not-an-email', 'a@b', `${'x'.repeat(250)}@example.com`, undefined])(
    'rejects %p as invalid without writing', async email => {
      const model = fakeModel();
      await expect(addAdmin({ email, addedBy: 'owner@example.com' }, { model })).resolves.toEqual({ ok: false, code: 'invalid' });
      expect(model.create).not.toHaveBeenCalled();
    }
  );

  test('refuses to add a built-in admin (they already have access)', async () => {
    const model = fakeModel();
    await expect(addAdmin({ email: 'OWNER@example.com', addedBy: 'x@example.com' }, { model }))
      .resolves.toEqual({ ok: false, code: 'builtin' });
    expect(model.create).not.toHaveBeenCalled();
  });

  test('reports a duplicate-key race as "exists"', async () => {
    const model = fakeModel({ createImpl: async () => { const e = new Error('dup'); e.code = 11000; throw e; } });
    await expect(addAdmin({ email: 'dup@example.com', addedBy: 'owner@example.com' }, { model }))
      .resolves.toEqual({ ok: false, code: 'exists' });
  });

  test('rethrows any other database error', async () => {
    const model = fakeModel({ createImpl: async () => { throw new Error('mongo down'); } });
    await expect(addAdmin({ email: 'x@example.com', addedBy: 'owner@example.com' }, { model })).rejects.toThrow('mongo down');
  });
});

describe('removeAdmin', () => {
  const id = '64b000000000000000000001';

  test('removes a dashboard admin', async () => {
    const model = fakeModel({ found: { _id: id, email: 'helper@example.com' } });
    await expect(removeAdmin({ id, actingEmail: 'owner@example.com' }, { model }))
      .resolves.toEqual({ ok: true, email: 'helper@example.com' });
    expect(model.deleteOne).toHaveBeenCalledWith({ _id: id });
  });

  test('refuses to let an admin remove themself', async () => {
    const model = fakeModel({ found: { _id: id, email: 'helper@example.com' } });
    await expect(removeAdmin({ id, actingEmail: ' Helper@Example.com ' }, { model }))
      .resolves.toEqual({ ok: false, code: 'self' });
    expect(model.deleteOne).not.toHaveBeenCalled();
  });

  test('reports an unknown or malformed id as notfound', async () => {
    const model = fakeModel({ found: null });
    await expect(removeAdmin({ id, actingEmail: 'owner@example.com' }, { model })).resolves.toEqual({ ok: false, code: 'notfound' });
    await expect(removeAdmin({ id: 'garbage', actingEmail: 'owner@example.com' }, { model })).resolves.toEqual({ ok: false, code: 'notfound' });
    expect(model.deleteOne).not.toHaveBeenCalled();
  });
});
