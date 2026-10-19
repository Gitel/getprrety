jest.mock('../providerCredentials', () => ({
  getKey: jest.fn(), recordHealth: jest.fn(async () => {}),
  classifyFailure: jest.requireActual('../providerCredentials').classifyFailure,
}));
const credentials = require('../providerCredentials');
const client = require('./client');
const originalFetch = global.fetch;
afterAll(() => { global.fetch = originalFetch; });
beforeEach(() => { jest.clearAllMocks(); credentials.getKey.mockResolvedValue('saved-key'); });

test('new calls resolve the saved key without needing a restart', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: { files: [] } }) }));
  await client.requestFileSlots([]);
  expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer saved-key');
  credentials.getKey.mockResolvedValue('replacement-key');
  await client.createTask('file-id');
  expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer replacement-key');
});

test('expiry updates admin health while preserving the public API error contract', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error_code: 'ExpiredApiKey' }) }));
  await expect(client.requestFileSlots([])).rejects.toMatchObject({ code: 'VENDOR_UNAVAILABLE' });
  expect(credentials.recordHealth).toHaveBeenCalledWith('perfectcorp', 'saved-key', 'expired');
});

test('presigned upload rejection is not mistaken for API key expiry', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 403 }));
  await expect(client.putToPresignedUrl('https://example.invalid', Buffer.from('fake'))).rejects.toThrow();
  expect(credentials.recordHealth).not.toHaveBeenCalled();
});
