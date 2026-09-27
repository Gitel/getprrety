const Message = require('../models/Message');
const m = require('./messages');

const UID = '64b0000000000000000000aa';

// Chainable stand-in for find().select().sort().limit().lean()
function query(result) {
  const q = {};
  ['select', 'sort', 'limit'].forEach(k => { q[k] = jest.fn(() => q); });
  q.lean = jest.fn(async () => result);
  return q;
}

describe('Message model', () => {
  test('rejects an unknown sender and an over-long body', () => {
    const err = new Message({ userId: UID, from: 'robot', body: 'x'.repeat(2001) }).validateSync();
    expect(err.errors.from).toBeDefined();
    expect(err.errors.body).toBeDefined();
  });
});

describe('cleanBody', () => {
  test('trims; rejects empty and too-long (never truncates)', () => {
    expect(m.cleanBody('  hi  ')).toEqual({ body: 'hi' });
    expect(m.cleanBody('   ')).toEqual({ error: 'empty' });
    expect(m.cleanBody(42)).toEqual({ error: 'empty' });
    expect(m.cleanBody('x'.repeat(2001))).toEqual({ error: 'too_long' });
    expect(m.cleanBody('x'.repeat(2000)).body).toHaveLength(2000);
  });
});

describe('app side', () => {
  test('the thread is oldest-first and never exposes which admin wrote it', async () => {
    const newestFirst = [
      { _id: 'm2', from: 'user', body: 'Thanks!', createdAt: 2, readAt: null },
      { _id: 'm1', from: 'admin', body: 'Hi Ada', adminEmail: 'lu@clinic.com', createdAt: 1, readAt: 5 },
    ];
    const model = { find: jest.fn(() => query(newestFirst)) };
    const thread = await m.threadForUser(UID, { model });
    expect(model.find).toHaveBeenCalledWith({ userId: UID });
    expect(thread.map(t => t.id)).toEqual(['m1', 'm2']);
    expect(JSON.stringify(thread)).not.toContain('lu@clinic.com');
    expect(thread[0]).toEqual({ id: 'm1', from: 'admin', body: 'Hi Ada', createdAt: 1, readAt: 5 });
  });

  test('unread count and mark-read only touch clinic messages of this user', async () => {
    const model = { countDocuments: jest.fn(async () => 3), updateMany: jest.fn(async () => ({})) };
    await expect(m.unreadForUser(UID, { model })).resolves.toBe(3);
    expect(model.countDocuments).toHaveBeenCalledWith({ userId: UID, from: 'admin', readAt: null });
    const now = new Date();
    await m.markReadByUser(UID, { model, now });
    expect(model.updateMany).toHaveBeenCalledWith({ userId: UID, from: 'admin', readAt: null }, { $set: { readAt: now } });
  });

  describe('postUserReply', () => {
    const deps = over => ({
      model: { create: jest.fn(async doc => ({ _id: 'new', createdAt: 9, readAt: null, ...doc })) },
      userModel: { exists: jest.fn(async () => ({ _id: UID })) },
      rateLimit: jest.fn(async () => true),
      ...over,
    });

    test('stores the reply as from:user and returns the app shape', async () => {
      const d = deps();
      const result = await m.postUserReply(UID, '  Thank you ', d);
      expect(d.model.create).toHaveBeenCalledWith({ userId: UID, from: 'user', body: 'Thank you' });
      expect(result).toEqual({ ok: true, message: { id: 'new', from: 'user', body: 'Thank you', createdAt: 9, readAt: null } });
      expect(d.rateLimit).toHaveBeenCalledWith('msg_user', UID, 20);
    });

    test('a deleted account (token still valid) cannot create orphan messages', async () => {
      const d = deps({ userModel: { exists: jest.fn(async () => null) } });
      await expect(m.postUserReply(UID, 'hello', d)).resolves.toEqual({ ok: false, code: 'user_gone' });
      expect(d.model.create).not.toHaveBeenCalled();
    });

    test('over the hourly limit is rejected without writing', async () => {
      const d = deps({ rateLimit: jest.fn(async () => false) });
      await expect(m.postUserReply(UID, 'hello', d)).resolves.toEqual({ ok: false, code: 'rate_limited' });
      expect(d.model.create).not.toHaveBeenCalled();
    });

    test('invalid bodies are rejected before any lookup', async () => {
      const d = deps();
      await expect(m.postUserReply(UID, '', d)).resolves.toEqual({ ok: false, code: 'empty' });
      expect(d.userModel.exists).not.toHaveBeenCalled();
    });
  });
});

describe('admin side', () => {
  test('sendAdminMessage stores who wrote it; refuses unknown users', async () => {
    const model = { create: jest.fn(async () => ({})) };
    const ok = await m.sendAdminMessage({ userId: UID, adminEmail: 'lu@clinic.com', body: ' Hi ' },
      { model, userModel: { exists: async () => ({}) } });
    expect(ok).toEqual({ ok: true });
    expect(model.create).toHaveBeenCalledWith({ userId: UID, from: 'admin', adminEmail: 'lu@clinic.com', body: 'Hi' });

    await expect(m.sendAdminMessage({ userId: UID, adminEmail: 'a', body: 'x' }, { model, userModel: { exists: async () => null } }))
      .resolves.toEqual({ ok: false, code: 'user_gone' });
    await expect(m.sendAdminMessage({ userId: 'bad', adminEmail: 'a', body: 'x' }, { model, userModel: { exists: async () => ({}) } }))
      .resolves.toEqual({ ok: false, code: 'user_gone' });
  });

  test('opening a thread marks only the user replies as read', async () => {
    const model = { updateMany: jest.fn(async () => ({})) };
    const now = new Date();
    await m.markReadByAdmin(UID, { model, now });
    expect(model.updateMany).toHaveBeenCalledWith({ userId: UID, from: 'user', readAt: null }, { $set: { readAt: now } });
  });

  test('inbox groups unread replies per user and attaches the user', async () => {
    const model = { aggregate: jest.fn(async () => [{ _id: UID, unread: 2, latestAt: 5, latestBody: 'Hello?' }]) };
    const userModel = { find: jest.fn(() => query([{ _id: UID, firstName: 'Ada', email: 'ada@x.co' }])) };
    const rows = await m.inbox({ model, userModel });
    expect(rows).toEqual([{ _id: UID, userId: UID, unread: 2, latestAt: 5, latestBody: 'Hello?', user: { _id: UID, firstName: 'Ada', email: 'ada@x.co' } }]);
  });

  test('an empty inbox skips the user lookup', async () => {
    const userModel = { find: jest.fn() };
    await expect(m.inbox({ model: { aggregate: async () => [] }, userModel })).resolves.toEqual([]);
    expect(userModel.find).not.toHaveBeenCalled();
  });
});
