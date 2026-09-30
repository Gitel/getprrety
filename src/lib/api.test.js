import { api } from './api';

jest.mock('./auth');

const { getToken } = require('./auth');

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// fetch never settles on its own — the only thing that ends the request is the
// AbortController firing, which is exactly what a timeout test needs to exercise.
const hangingFetch = () =>
  jest.fn(
    (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })
  );

beforeEach(() => {
  jest.clearAllMocks();
  getToken.mockResolvedValue('test-token');
});

afterEach(() => {
  jest.useRealTimers();
});

test('a timeout rejects with status 408', async () => {
  jest.useFakeTimers();
  global.fetch = hangingFetch();

  const pending = api.get('/api/slow');
  const assertion = expect(pending).rejects.toMatchObject({ status: 408 });
  await jest.advanceTimersByTimeAsync(15000);
  await assertion;
});

test('a non-ok response rejects with the server error message and its status', async () => {
  global.fetch = jest.fn().mockResolvedValue(
    jsonResponse(403, { error: 'Skin scan is not owned by this user' })
  );

  await expect(api.get('/api/scans/1')).rejects.toMatchObject({
    message: 'Skin scan is not owned by this user',
    status: 403,
  });
});

test('opts.timeoutMs overrides the default', async () => {
  jest.useFakeTimers();
  global.fetch = hangingFetch();

  const pending = api.get('/api/slow', { timeoutMs: 500 });
  const assertion = expect(pending).rejects.toMatchObject({ status: 408, message: 'Request timed out after 500ms' });

  // Advancing past 500ms but short of the 15000ms default proves the override,
  // not just that some timeout eventually fires.
  await jest.advanceTimersByTimeAsync(500);
  await assertion;
});

test('a successful response resolves with the parsed body', async () => {
  global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { id: 'abc', name: 'ok' }));

  await expect(api.get('/api/thing')).resolves.toEqual({ id: 'abc', name: 'ok' });
});

test('a non-ok response carries the server code and params', async () => {
  global.fetch = jest.fn().mockResolvedValue(
    jsonResponse(400, { error: 'Password must be at least 8 characters', code: 'password_too_short', params: { min: 8 } })
  );

  await expect(api.post('/api/auth/signup', {})).rejects.toMatchObject({
    message: 'Password must be at least 8 characters',
    status: 400,
    code: 'password_too_short',
    params: { min: 8 },
  });
});

test('a non-ok response without a code (old server) has no code', async () => {
  global.fetch = jest.fn().mockResolvedValue(jsonResponse(400, { error: 'Nope' }));

  const err = await api.get('/api/x').catch(e => e);
  expect(err.message).toBe('Nope');
  expect(err.code).toBeUndefined();
});

test('a timeout carries code "timeout"', async () => {
  jest.useFakeTimers();
  global.fetch = hangingFetch();

  const assertion = expect(api.get('/api/slow')).rejects.toMatchObject({ status: 408, code: 'timeout' });
  await jest.advanceTimersByTimeAsync(15000);
  await assertion;
});

test('a fetch TypeError (network down) carries code "network"', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

  await expect(api.get('/api/x')).rejects.toMatchObject({ code: 'network' });
});
