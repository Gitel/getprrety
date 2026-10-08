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
    catalogueProductId: null,
    bookingId: null,
    targetAdminEmail: null,
    fields: ['routine'],
  });
});

test('defaults every target to empty when none is given', async () => {
  const model = { create: jest.fn().mockResolvedValue({}) };
  await logAdminAction(req, 'admin_added', undefined, { model });
  expect(model.create.mock.calls[0][0]).toMatchObject({ userId: null, analysisId: null, catalogueProductId: null, bookingId: null, fields: [] });
});

test('passes the catalogue product id through', async () => {
  const model = { create: jest.fn().mockResolvedValue({}) };
  await logAdminAction(req, 'catalogue_product_updated', { catalogueProductId: 'p1', fields: ['name'] }, { model });
  expect(model.create.mock.calls[0][0]).toMatchObject({ catalogueProductId: 'p1', userId: null, fields: ['name'] });
});

test('never throws: a failed audit write is logged, the action already succeeded', async () => {
  const model = { create: jest.fn().mockRejectedValue(new Error('mongo down')) };
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await expect(logAdminAction(req, 'message_sent', {}, { model })).resolves.toBeUndefined();
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});

test('passes the booking id (and the client) through for booking_cancelled', async () => {
  const model = { create: jest.fn().mockResolvedValue({}) };
  await logAdminAction(req, 'booking_cancelled', { userId: 'u1', bookingId: 'b1' }, { model });
  expect(model.create.mock.calls[0][0]).toMatchObject({ action: 'booking_cancelled', userId: 'u1', bookingId: 'b1', catalogueProductId: null, fields: [] });
});

test('booking_settings_updated carries the changed setting names and no booking id', async () => {
  const model = { create: jest.fn().mockResolvedValue({}) };
  await logAdminAction(req, 'booking_settings_updated', { fields: ['leadHours'] }, { model });
  expect(model.create.mock.calls[0][0]).toMatchObject({ bookingId: null, userId: null, fields: ['leadHours'] });
});
