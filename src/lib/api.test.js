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
