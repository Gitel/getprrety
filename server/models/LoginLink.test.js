// Schema-level tests for the LoginLink model. No database: validateSync() and schema.indexes() only.
const LoginLink = require('./LoginLink');

const valid = () => ({ purpose: 'signin', tokenHash: 'a'.repeat(64), tokenEnc: 'enc', expiresAt: new Date('2026-10-20T00:00:00Z') });

test('a minimal link is valid and gets the documented defaults', () => {
  const doc = new LoginLink(valid());
  expect(doc.validateSync()).toBeUndefined();
  expect(doc.userId).toBeNull();
  expect(doc.usedAt).toBeNull();
  expect(doc.revokedAt).toBeNull();
  expect(doc.lastSentAt).toBeNull();
  expect(doc.sendCount).toBe(0);
  expect(doc.lastSendError).toBeNull();
});

test('purpose, tokenHash, tokenEnc and expiresAt are required', () => {
  const errors = new LoginLink({}).validateSync().errors;
  for (const f of ['purpose', 'tokenHash', 'tokenEnc', 'expiresAt']) expect(errors[f]).toBeDefined();
});

test('purpose only accepts signin and invite', () => {
  expect(new LoginLink({ ...valid(), purpose: 'invite' }).validateSync()).toBeUndefined();
  expect(new LoginLink({ ...valid(), purpose: 'reset' }).validateSync().errors.purpose).toBeDefined();
});

test('invite email is lowercased and trimmed, language is en|he', () => {
  const doc = new LoginLink({ ...valid(), purpose: 'invite', invite: { email: '  A@B.CO ', firstName: ' Ada ', language: 'he' } });
  expect(doc.validateSync()).toBeUndefined();
  expect(doc.invite.email).toBe('a@b.co');
  expect(doc.invite.firstName).toBe('Ada');
  expect(new LoginLink({ ...valid(), invite: { language: 'fr' } }).validateSync()).toBeDefined();
});

test('userId references User; timestamps on; LIFETIME_HOURS is 72', () => {
  expect(LoginLink.schema.path('userId').options.ref).toBe('User');
  expect(LoginLink.schema.path('createdAt')).toBeDefined();
  expect(LoginLink.LIFETIME_HOURS).toBe(72);
});

describe('indexes', () => {
  const indexes = LoginLink.schema.indexes();
  const find = keys => indexes.find(([fields]) => JSON.stringify(fields) === JSON.stringify(keys));

  test('tokenHash is unique', () => {
    expect(LoginLink.schema.path('tokenHash').options.unique).toBe(true);
  });
  test('{userId:1, createdAt:-1} and {invite.email:1, createdAt:-1} exist', () => {
    expect(find({ userId: 1, createdAt: -1 })).toBeDefined();
    expect(find({ 'invite.email': 1, createdAt: -1 })).toBeDefined();
  });
  test('TTL on expiresAt keeps rows 30 days after expiry', () => {
    expect(find({ expiresAt: 1 })[1].expireAfterSeconds).toBe(30 * 24 * 3600);
  });
});
