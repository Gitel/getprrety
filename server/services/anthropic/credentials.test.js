const credentials = require('../providerCredentials');
const client = require('./client');

afterEach(() => jest.restoreAllMocks());
const fields = { system: '', messages: [{ role: 'user', content: 'synthetic' }], schema: { type: 'object' } };

test('Anthropic resolves the current stored credential for each new request', async () => {
  const getKey = jest.spyOn(credentials, 'getKey').mockResolvedValueOnce('first-key').mockResolvedValueOnce('second-key');
  const sdkClient = { messages: { countTokens: jest.fn(async () => ({ input_tokens: 3 })) } };
  expect(await client.countTokens({ ...fields, sdkClient })).toEqual({ inputTokens: 3 });
  expect(await client.countTokens({ ...fields, sdkClient })).toEqual({ inputTokens: 3 });
  expect(getKey).toHaveBeenNthCalledWith(1, 'anthropic');
  expect(getKey).toHaveBeenNthCalledWith(2, 'anthropic');
});

test.each(['countTokens', 'completeJson'])('%s records credential rejection and keeps existing error semantics', async method => {
  jest.spyOn(credentials, 'getKey').mockResolvedValue('saved-key');
  const record = jest.spyOn(credentials, 'recordHealth').mockResolvedValue();
  const sdkClient = { messages: { countTokens: jest.fn(async () => { throw { status: 401 }; }) } };
  await expect(client[method]({ ...fields, sdkClient })).rejects.toMatchObject({ code: 'ANTHROPIC_HTTP_401' });
  expect(record).toHaveBeenCalledWith('anthropic', 'saved-key', 'rejected');
});

test('explicit evaluation keys never change production credential health', async () => {
  const getKey = jest.spyOn(credentials, 'getKey');
  const record = jest.spyOn(credentials, 'recordHealth').mockResolvedValue();
  const sdkClient = { messages: { countTokens: jest.fn(async () => { throw { status: 401 }; }) } };
  await expect(client.countTokens({ ...fields, token: 'evaluation-key', sdkClient })).rejects.toThrow();
  expect(getKey).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
});

test('database-backed availability supports a key with no environment value', async () => {
  jest.spyOn(credentials, 'getKey').mockResolvedValueOnce('saved-key').mockResolvedValueOnce('');
  expect(await client.isConfigured()).toBe(true);
  expect(await client.isConfigured()).toBe(false);
});
