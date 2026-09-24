const AdminAuditLog = require('./AdminAuditLog');

// Same guard as ActivityLog.test.js: an action the routes log but the enum rejects would
// fail validation and (because logAdminAction is best-effort) record nothing, silently.
// Keep this list in sync by hand with the logAdminAction() calls in routes/admin.js.
const ACTIONS_THE_ROUTES_LOG = [
  'admin_added',
  'admin_removed',
  'clinic_email_resent',
  'user_profile_updated',
  'analysis_fields_updated',
  'routine_updated',
  'product_audit_updated',
  'product_picks_updated',
  'sr_ritual_updated',
  'shelf_updated',
  'message_sent',
  'user_deleted',
];

test('the action enum accepts every action the routes log', () => {
  const allowed = AdminAuditLog.schema.path('action').enumValues;
  for (const action of ACTIONS_THE_ROUTES_LOG) expect(allowed).toContain(action);
});

test('an unknown action fails validation', () => {
  const doc = new AdminAuditLog({ adminEmail: 'a@b.co', action: 'not_real' });
  expect(doc.validateSync().errors.action).toBeDefined();
});

test('a valid entry defaults its optional targets to null / []', () => {
  const doc = new AdminAuditLog({ adminEmail: 'A@B.co', action: 'message_sent' });
  expect(doc.validateSync()).toBeUndefined();
  expect(doc.adminEmail).toBe('a@b.co');
  expect(doc.userId).toBeNull();
  expect(doc.fields).toEqual([]);
});
