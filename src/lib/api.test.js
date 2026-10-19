import { api } from './api';

jest.mock('./auth');

const { getToken } = require('./auth');

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
});

function streamResponse(chunks, status = 200) {
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'text/event-stream; charset=utf-8' },
    body: { getReader: () => ({
      read: async () => index < chunks.length ? { value: chunks[index++], done: false } : { done: true },
      cancel: jest.fn(), releaseLock: jest.fn(),
    }) },
  };
}

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

test('stream mode parses split UTF-8 and CRLF events and emits only safe phases', async () => {
  const requestId = '59d9b74b-d8ba-4a22-93d9-f459439d7c30';
  const text = `: heartbeat\r\nevent: progress\r\ndata: {"phase":"waiting","requestId":"${requestId}"}\r\n\r\nevent: progress\r\ndata: {"phase":"generating","requestId":"${requestId}"}\r\n\r\nevent: complete\r\ndata: {"requestId":"${requestId}","analysis":{"source":"anthropic","label":"é😀"}}\r\n\r\n`;
  const bytes = new TextEncoder().encode(text);
  global.fetch = jest.fn().mockResolvedValue(streamResponse([bytes.slice(0, 62), bytes.slice(62, 63), bytes.slice(63)]));
  const onProgress = jest.fn();

  await expect(api.post('/api/ai/analyze-skin', {}, { stream: true, onProgress }))
    .resolves.toEqual({ source: 'anthropic', label: 'é😀' });
  expect(onProgress.mock.calls).toEqual([[{ phase: 'waiting', requestId }], [{ phase: 'generating', requestId }]]);
  expect(global.fetch.mock.calls[0][1].headers.Accept).toBe('text/event-stream, application/json');
});

test('stream errors preserve sanitized status and code', async () => {
  const bytes = new TextEncoder().encode('event: error\ndata: {"error":"Analysis unavailable","status":503,"code":"provider_unavailable"}\n\n');
  global.fetch = jest.fn().mockResolvedValue(streamResponse([bytes]));
  await expect(api.post('/api/ai/analyze-skin', {}, { stream: true })).rejects.toMatchObject({
    message: 'Analysis unavailable', status: 503, code: 'provider_unavailable',
  });
});

test('stream ending without a complete event rejects', async () => {
  const bytes = new TextEncoder().encode('event: progress\ndata: {"phase":"validating"}\n\n');
  global.fetch = jest.fn().mockResolvedValue(streamResponse([bytes]));
  await expect(api.post('/api/ai/analyze-skin', {}, { stream: true })).rejects.toThrow('ended before completion');
});

test('a complete event followed by an error rejects the whole stream', async () => {
  const text = 'event: complete\ndata: {"analysis":{"source":"anthropic"}}\n\nevent: error\ndata: {"error":"Analysis failed","status":503}\n\n';
  global.fetch = jest.fn().mockResolvedValue(streamResponse([new TextEncoder().encode(text)]));
  await expect(api.post('/api/ai/analyze-skin', {}, { stream: true })).rejects.toMatchObject({ message: 'Analysis failed', status: 503 });
});

test('duplicate complete events reject the whole stream', async () => {
  const complete = 'event: complete\ndata: {"analysis":{"source":"anthropic"}}\n\n';
  global.fetch = jest.fn().mockResolvedValue(streamResponse([new TextEncoder().encode(complete + complete)]));
  await expect(api.post('/api/ai/analyze-skin', {}, { stream: true })).rejects.toThrow('Duplicate analysis completion');
});

test('a complete event followed by an unterminated error frame rejects the stream', async () => {
  const complete = 'event: complete\ndata: {"analysis":{"source":"anthropic"}}\n\n';
  const truncatedError = 'event: error\ndata: {"error":"late failure"';
  global.fetch = jest.fn().mockResolvedValue(streamResponse([new TextEncoder().encode(complete + truncatedError)]));
  await expect(api.post('/api/ai/analyze-skin', {}, { stream: true })).rejects.toThrow('incomplete event');
});

test('an unterminated complete event is rejected', async () => {
  const truncated = 'event: complete\ndata: {"analysis":{"source":"anthropic"}}';
  global.fetch = jest.fn().mockResolvedValue(streamResponse([new TextEncoder().encode(truncated)]));
  await expect(api.post('/api/ai/analyze-skin', {}, { stream: true })).rejects.toThrow('incomplete event');
});

test('the stream body deadline continues after response headers', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: { getReader: () => ({
      read: () => new Promise((resolve, reject) => {
        global.fetch.mock.calls[0][1].signal.addEventListener('abort', () => {
          const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
        }, { once: true });
      }),
      cancel: jest.fn(),
    }) },
  });
  const pending = api.post('/api/ai/analyze-skin', {}, { timeoutMs: 500, stream: true });
  const assertion = expect(pending).rejects.toMatchObject({ status: 408, code: 'timeout' });
  await jest.advanceTimersByTimeAsync(500);
  await assertion;
});

test('SSE heartbeats do not extend the fixed body deadline', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: { getReader: () => {
      let sentHeartbeat = false;
      return {
        read: () => sentHeartbeat
          ? new Promise((resolve, reject) => global.fetch.mock.calls[0][1].signal.addEventListener('abort', () => {
            const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
          }, { once: true }))
          : (sentHeartbeat = true, Promise.resolve({ value: new TextEncoder().encode(': keepalive\n\n'), done: false })),
        cancel: jest.fn(),
      };
    } },
  });
  const pending = api.post('/api/ai/analyze-skin', {}, { timeoutMs: 500, stream: true });
  const assertion = expect(pending).rejects.toMatchObject({ status: 408, code: 'timeout' });
  await jest.advanceTimersByTimeAsync(500);
  await assertion;
});

test('the deadline remains active after complete until the stream reaches EOF', async () => {
  jest.useFakeTimers();
  const requestId = '59d9b74b-d8ba-4a22-93d9-f459439d7c30';
  const complete = new TextEncoder().encode(`event: progress\ndata: {"phase":"validating","requestId":"${requestId}"}\n\nevent: complete\ndata: {"requestId":"${requestId}","analysis":{"source":"anthropic"}}\n\n`);
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: { getReader: () => ({
      read: jest.fn().mockResolvedValueOnce({ value: complete, done: false }).mockImplementation(() => new Promise((resolve, reject) => {
        global.fetch.mock.calls[0][1].signal.addEventListener('abort', () => {
          const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
        }, { once: true });
      })),
      cancel: jest.fn(), releaseLock: jest.fn(),
    }) },
  });
  const info = jest.spyOn(console, 'info').mockImplementation(() => {});
  const pending = api.post('/api/ai/analyze-skin', {}, { timeoutMs: 500, stream: true });
  const assertion = expect(pending).rejects.toMatchObject({ status: 408, code: 'timeout' });
  await jest.advanceTimersByTimeAsync(500);
  await assertion;
  expect(info).toHaveBeenCalledWith('[analysis-stream] timed out', { requestId, phase: 3 });
  info.mockRestore();
});

test('an AbortError while reading a legacy JSON body remains a timeout', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockImplementation((url, options) => Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
      const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
    }, { once: true })),
  }));
  const pending = api.post('/api/ai/analyze-skin', {}, { timeoutMs: 500, stream: true });
  const assertion = expect(pending).rejects.toMatchObject({ status: 408, code: 'timeout' });
  await jest.advanceTimersByTimeAsync(500);
  await assertion;
});
