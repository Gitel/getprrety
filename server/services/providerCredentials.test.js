const credentials = require('./providerCredentials');

const KEY = 'synthetic-provider-key';
const OTHER = 'replacement-provider-key';
const originalEnv = { ...process.env };
function fakeModel() {
  const docs = new Map();
  const model = {
    docs,
    findById: jest.fn(id => ({ select: () => ({ maxTimeMS: () => ({ lean: async () => docs.get(id) || null }) }) })),
    findByIdAndUpdate: jest.fn(async (id, update) => {
      docs.set(id, { ...docs.get(id), ...update.$set });
    }),
    updateOne: jest.fn(async (filter, update) => {
      const doc = docs.get(filter._id);
      const matches = typeof filter.fingerprint === 'object' ? !doc?.fingerprint : doc?.fingerprint === filter.fingerprint;
      if (matches) docs.set(filter._id, { ...doc, ...update.$set });
    }),
  };
  return model;
}
const slot = { data: { files: [{ file_id: 'fake-id', requests: [{ url: 'https://example.invalid/upload' }] }] } };
const okFetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => slot }));
const expiredFetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error_code: 'ExpiredApiKey', error: KEY }) }));

beforeEach(() => {
  process.env.API_KEYS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.PERFECTCORP_API_KEY = 'environment-provider-key';
  delete process.env.ANTHROPIC_API_KEY;
  jest.clearAllMocks();
});
afterAll(() => { process.env = originalEnv; });

test('environment fallback, encrypted precedence, immediate rotation and safe public metadata', async () => {
  const model = fakeModel();
  expect(await credentials.getKey('perfectcorp', { model })).toBe('environment-provider-key');
  await credentials.saveKey('perfectcorp', KEY, 'admin@example.com', { model, fetchImpl: okFetch });
  const stored = model.docs.get('perfectcorp');
  expect(stored.encrypted).not.toContain(KEY);
  expect(JSON.stringify(stored)).not.toContain(KEY);
  expect(await credentials.getKey('perfectcorp', { model })).toBe(KEY);
  expect(JSON.stringify(await credentials.listStatus({ model }))).not.toContain(stored.encrypted);
  await credentials.saveKey('perfectcorp', OTHER, 'admin@example.com', { model, fetchImpl: okFetch });
  expect(await credentials.getKey('perfectcorp', { model })).toBe(OTHER);
});

test('a failed replacement leaves the entire current credential and status untouched', async () => {
  const model = fakeModel();
  await credentials.saveKey('perfectcorp', KEY, 'admin@example.com', { model, fetchImpl: okFetch });
  const before = JSON.stringify(model.docs.get('perfectcorp'));
  expect(await credentials.saveKey('perfectcorp', OTHER, 'admin@example.com', { model, fetchImpl: expiredFetch }))
    .toMatchObject({ ok: false, health: 'expired' });
  expect(JSON.stringify(model.docs.get('perfectcorp'))).toBe(before);
  expect(model.findByIdAndUpdate).toHaveBeenCalledTimes(1);
});

test('ciphertext is bound to its provider and authentication tag; wrong master key fails closed', async () => {
  const model = fakeModel();
  await credentials.saveKey('perfectcorp', KEY, 'admin@example.com', { model, fetchImpl: okFetch });
  model.docs.set('anthropic', { ...model.docs.get('perfectcorp') });
  await expect(credentials.getKey('anthropic', { model })).rejects.toThrow('could not be opened');
  process.env.API_KEYS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  await expect(credentials.getKey('perfectcorp', { model })).rejects.toThrow('could not be opened');
  delete process.env.API_KEYS_ENCRYPTION_KEY;
  await expect(credentials.getKey('perfectcorp', { model })).rejects.toThrow('could not be opened');
});

test('new encryption uses a fresh nonce even for the same key', async () => {
  const model = fakeModel();
  await credentials.saveKey('perfectcorp', KEY, 'admin@example.com', { model, fetchImpl: okFetch });
  const first = model.docs.get('perfectcorp').encrypted;
  await credentials.saveKey('perfectcorp', KEY, 'admin@example.com', { model, fetchImpl: okFetch });
  expect(model.docs.get('perfectcorp').encrypted).not.toBe(first);
});

test('modified ciphertext is rejected instead of decrypted or replaced by the environment key', async () => {
  const model = fakeModel();
  await credentials.saveKey('perfectcorp', KEY, 'admin@example.com', { model, fetchImpl: okFetch });
  const parts = model.docs.get('perfectcorp').encrypted.split('.');
  const bytes = Buffer.from(parts[2], 'base64'); bytes[0] ^= 1;
  parts[2] = bytes.toString('base64');
  model.docs.get('perfectcorp').encrypted = parts.join('.');
  await expect(credentials.getKey('perfectcorp', { model })).rejects.toThrow('could not be opened');
});

test('one-time setup must be valid before verification or saving', async () => {
  const model = fakeModel();
  process.env.API_KEYS_ENCRYPTION_KEY = 'placeholder';
  expect(credentials.storageReady()).toBe(false);
  expect(await credentials.saveKey('perfectcorp', KEY, 'a', { model, fetchImpl: okFetch })).toMatchObject({ ok: false });
  expect(okFetch).not.toHaveBeenCalled();
  expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
});

test('actual upload verification detects expiry without returning raw provider messages', async () => {
  expect(await credentials.verify('perfectcorp', KEY, { fetchImpl: expiredFetch }))
    .toEqual({ ok: false, health: 'expired', message: credentials.HEALTH.expired });
  expect(JSON.stringify(await credentials.verify('perfectcorp', KEY, { fetchImpl: expiredFetch }))).not.toContain(KEY);
  const [url, options] = expiredFetch.mock.calls[0];
  expect(url).toMatch(/\/file\/skin-analysis$/);
  expect(options.redirect).toBe('error');
  expect(JSON.parse(options.body).files[0].file_size).toBe(1024);
});

test('Anthropic verification checks the production model without generating content', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ id: require('./anthropic/client').MODEL }) }));
  expect(await credentials.verify('anthropic', KEY, { fetchImpl })).toMatchObject({ ok: true });
  expect(fetchImpl.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models/claude-opus-5-5');
  expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('body');
});

test.each(['bad key with spaces', '', null, {}, 'a'.repeat(513)])('invalid candidate %p is not transmitted', async key => {
  expect(await credentials.verify('perfectcorp', key, { fetchImpl: okFetch })).toMatchObject({ ok: false });
  expect(okFetch).not.toHaveBeenCalled();
});

test('timeouts/network failure and malformed successful responses never authorize a save', async () => {
  expect(await credentials.verify('perfectcorp', KEY, { fetchImpl: async () => { throw new Error(KEY); } }))
    .toMatchObject({ ok: false, health: 'unavailable' });
  const fetchImpl = async () => ({ ok: true, json: async () => ({}) });
  const model = fakeModel();
  expect(await credentials.saveKey('perfectcorp', KEY, 'a', { model, fetchImpl })).toMatchObject({ ok: false });
  expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
});

test('expiry is visible for saved and environment keys; old in-flight failures cannot poison a replacement', async () => {
  const model = fakeModel();
  await credentials.checkCurrent('perfectcorp', { model, fetchImpl: expiredFetch });
  expect((await credentials.listStatus({ model }))[0]).toMatchObject({ health: 'expired', source: 'Server environment' });
  await credentials.saveKey('perfectcorp', KEY, 'a', { model, fetchImpl: okFetch });
  await credentials.recordHealth('perfectcorp', KEY, 'expired', { model });
  expect((await credentials.listStatus({ model }))[0].health).toBe('expired');
  await credentials.saveKey('perfectcorp', OTHER, 'a', { model, fetchImpl: okFetch });
  await credentials.recordHealth('perfectcorp', KEY, 'expired', { model });
  expect((await credentials.listStatus({ model }))[0].health).toBe('verified');
});

test('changed environment keys do not inherit an old failure status', async () => {
  const model = fakeModel();
  await credentials.checkCurrent('perfectcorp', { model, fetchImpl: expiredFetch });
  process.env.PERFECTCORP_API_KEY = OTHER;
  expect((await credentials.listStatus({ model }))[0]).toMatchObject({ health: 'unknown', checkedAt: null });
});

test('an expiry write racing with rotation cannot overwrite the replacement status', async () => {
  const model = fakeModel();
  await credentials.saveKey('perfectcorp', KEY, 'a', { model, fetchImpl: okFetch });
  const applyUpdate = model.updateOne.getMockImplementation();
  model.updateOne.mockImplementationOnce(async (...args) => {
    // Rotate after recordHealth has read the old document, but before its conditional write.
    await credentials.saveKey('perfectcorp', OTHER, 'a', { model, fetchImpl: okFetch });
    return applyUpdate(...args);
  });
  await credentials.recordHealth('perfectcorp', KEY, 'expired', { model });
  expect((await credentials.listStatus({ model }))[0].health).toBe('verified');
  expect(await credentials.getKey('perfectcorp', { model })).toBe(OTHER);
});

test('database failure fails closed instead of falling back to an old environment key', async () => {
  const model = fakeModel();
  model.findById.mockImplementation(() => { throw new Error('DB offline'); });
  await expect(credentials.getKey('perfectcorp', { model })).rejects.toThrow();
});

test('secret model fields are excluded by default', () => {
  const schema = require('../models/ProviderCredential').schema;
  expect(schema.path('encrypted').options.select).toBe(false);
  expect(schema.path('fingerprint').options.select).toBe(false);
});
