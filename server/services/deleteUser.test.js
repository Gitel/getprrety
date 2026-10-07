const fs = require('fs');
const path = require('path');
const { deleteUserAndData, USER_DATA } = require('./deleteUser');

const ID = '64b0000000000000000000aa';

function fakes(user) {
  const order = [];
  const dataModels = {};
  ['SkinAnalysis', 'Upload', 'Message'].forEach(name => {
    dataModels[name] = { deleteMany: jest.fn(async () => { order.push(name); return { deletedCount: 2 }; }) };
  });
  const userModel = {
    findById: jest.fn(() => ({ select: () => ({ lean: async () => user }) })),
    deleteOne: jest.fn(async () => { order.push('User'); return { deletedCount: 1 }; }),
  };
  return { userModel, dataModels, order };
}

test('deletes every data collection by userId, then the account last', async () => {
  const f = fakes({ _id: ID, email: 'ada@example.com' });
  const result = await deleteUserAndData(ID, '  ADA@example.com ', f);
  expect(result).toEqual({ ok: true, counts: { SkinAnalysis: 2, Upload: 2, Message: 2 } });
  Object.values(f.dataModels).forEach(m => expect(m.deleteMany).toHaveBeenCalledWith({ userId: ID }));
  expect(f.order[f.order.length - 1]).toBe('User');
});

test('refuses when the typed email does not match, deleting nothing', async () => {
  const f = fakes({ _id: ID, email: 'ada@example.com' });
  await expect(deleteUserAndData(ID, 'eve@example.com', f)).resolves.toEqual({ ok: false, code: 'delete_confirm_mismatch' });
  await expect(deleteUserAndData(ID, undefined, f)).resolves.toEqual({ ok: false, code: 'delete_confirm_mismatch' });
  Object.values(f.dataModels).forEach(m => expect(m.deleteMany).not.toHaveBeenCalled());
  expect(f.userModel.deleteOne).not.toHaveBeenCalled();
});

test('unknown or malformed ids are notfound', async () => {
  await expect(deleteUserAndData(ID, 'x', fakes(null))).resolves.toEqual({ ok: false, code: 'user_notfound' });
  await expect(deleteUserAndData('nope', 'x', fakes(null))).resolves.toEqual({ ok: false, code: 'user_notfound' });
});

test('a failure midway leaves the account in place so the admin can retry', async () => {
  const f = fakes({ _id: ID, email: 'ada@example.com' });
  f.dataModels.Upload.deleteMany.mockRejectedValue(new Error('mongo down'));
  await expect(deleteUserAndData(ID, 'ada@example.com', f)).rejects.toThrow('mongo down');
  expect(f.userModel.deleteOne).not.toHaveBeenCalled();
});

// Guard against a future per-user model being forgotten: every model file with a
// `userId` field must be in USER_DATA, except the documented exceptions.
test('USER_DATA covers every model that stores per-user documents', () => {
  const dir = path.join(__dirname, '..', 'models');
  const EXCEPTIONS = ['AdminAuditLog']; // keeps the (dangling) id as the deletion record
  const perUser = fs.readdirSync(dir)
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
    .filter(f => /\buserId\s*:/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .map(f => f.replace(/\.js$/, ''))
    .filter(name => !EXCEPTIONS.includes(name));
  expect(Object.keys(USER_DATA).sort()).toEqual(perUser.sort());
});

// Contract section 13: upcoming calendar events are released BEFORE any row is deleted.
test('releases the user\'s bookings before deleting rows, when Booking is in the data models', async () => {
  const f = fakes({ _id: ID, email: 'ada@example.com' });
  f.dataModels.Booking = { deleteMany: jest.fn(async () => { f.order.push('Booking'); return { deletedCount: 1 }; }) };
  const releaseBookings = jest.fn(async () => { f.order.push('release'); });
  await deleteUserAndData(ID, 'ada@example.com', { ...f, releaseBookings });
  expect(releaseBookings).toHaveBeenCalledWith(ID);
  expect(f.order[0]).toBe('release');
  expect(f.order).toContain('Booking');
});

test('the account is still deleted when releasing bookings fails', async () => {
  const f = fakes({ _id: ID, email: 'ada@example.com' });
  f.dataModels.Booking = { deleteMany: jest.fn(async () => ({ deletedCount: 0 })) };
  const releaseBookings = jest.fn(async () => { throw new Error('calendar down'); });
  const result = await deleteUserAndData(ID, 'ada@example.com', { ...f, releaseBookings });
  expect(result.ok).toBe(true);
  expect(f.userModel.deleteOne).toHaveBeenCalled();
});

test('USER_DATA includes Booking', () => {
  expect(Object.keys(USER_DATA)).toContain('Booking');
});
