const { logAdminAction } = require('./adminAudit');

const req = { admin: { email: 'admin@example.com' } };

test('writes the acting admin, action and targets', async () => {
  const model = { create: jest.fn().mockResolvedValue({}) };
  await logAdminAction(req, 'routine_updated', { userId: 'u1', analysisId: 'a1', fields: ['routine'] }, { model });
  expect(model.create).toHaveBeenCalledWith({
    adminEmail: 'admin@example.com',
    action: 'routine_updated',
    userId: 'u1',
    analysisId: 'a1',
    targetAdminEmail: null,
    fields: ['routine'],
  });
});

test('defaults every target to empty when none is given', async () => {
  const model = { create: jest.fn().mockResolvedValue({}) };
  await logAdminAction(req, 'admin_added', undefined, { model });
  expect(model.create.mock.calls[0][0]).toMatchObject({ userId: null, analysisId: null, fields: [] });
});

test('never throws: a failed audit write is logged, the action already succeeded', async () => {
  const model = { create: jest.fn().mockRejectedValue(new Error('mongo down')) };
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(logAdminAction(req, 'message_sent', {}, { model })).resolves.toBeUndefined();
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});
