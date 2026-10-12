const { completeJson, BASE_URL, MODEL, TIMEOUT_MS, MAX_OUTPUT_TOKENS, MAX_REPORTED_COST_USD, reportedCostUsd } = require('./client');

const schema = {
  type: 'object', additionalProperties: false, required: ['ok'],
  properties: { ok: { type: 'boolean' } },
};
const response = body => ({ ok: true, json: async () => ({
  usage: { prompt_tokens: 100, completion_tokens: 100 },
  ...body,
  choices: body.choices?.map(choice => ({ finish_reason: 'stop', ...choice })),
}) });

test('uses the fixed Oregon model, strict schema, and server-only bearer token', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response({ choices: [{ message: { content: '{"ok":true}' } }] }));
  await expect(completeJson({
    system: 'system', messages: [{ role: 'user', content: 'input' }], schema, token: 'test-token', fetchImpl,
  })).resolves.toEqual({ ok: true });
  const [url, options] = fetchImpl.mock.calls[0];
  expect(url).toBe(`${BASE_URL}/chat/completions`);
  expect(options.headers.Authorization).toBe('Bearer test-token');
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(options.body)).toMatchObject({
    model: MODEL,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    reasoning_effort: 'low',
    response_format: { type: 'json_schema', json_schema: { strict: true, schema } },
  });
  expect(TIMEOUT_MS).toBe(90_000);
});

test('does not call the provider when the server token is missing', async () => {
  const fetchImpl = jest.fn();
  await expect(completeJson({ system: '', messages: [], schema, token: '', fetchImpl }))
    .rejects.toMatchObject({ code: 'BEDROCK_NOT_CONFIGURED', status: 503 });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('validates returned JSON against the supplied schema', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response({ choices: [{ message: { content: '{"ok":"yes"}' } }] }));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl }))
    .rejects.toMatchObject({ code: 'BEDROCK_SCHEMA_INVALID' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('compiles the shared nullable analysis schema in Ajv strict mode', async () => {
  const { outputSchema } = require('./analysisContract');
  const fetchImpl = jest.fn().mockResolvedValue(response({ choices: [{ message: { content: '{}' } }] }));
  await expect(completeJson({ system: '', messages: [], schema: outputSchema, token: 'test-token', fetchImpl }))
    .rejects.toMatchObject({ code: 'BEDROCK_SCHEMA_INVALID' });
});

test('fails closed on malformed JSON and provider errors without echoing upstream bodies', async () => {
  const malformed = jest.fn().mockResolvedValue(response({ choices: [{ message: { content: 'not-json' } }] }));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl: malformed }))
    .rejects.toMatchObject({ code: 'BEDROCK_INVALID_JSON' });
  const rejected = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'private upstream text' });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl: rejected }))
    .rejects.toMatchObject({ code: 'BEDROCK_HTTP_429', message: 'Analysis provider failed' });
});

test.each([
  ['refusal', { message: { content: '{"ok":true}', refusal: 'restricted content' }, finish_reason: 'stop' }, 'BEDROCK_REFUSED'],
  ['truncated output', { message: { content: '{"ok":true}', refusal: null }, finish_reason: 'length' }, 'BEDROCK_OUTPUT_TRUNCATED'],
])('rejects %s even when the partial content parses', async (_label, choice, code) => {
  const fetchImpl = jest.fn().mockResolvedValue(response({ choices: [choice] }));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl }))
    .rejects.toMatchObject({ code });
});

test('applies the timeout through response-body consumption and never retries', async () => {
  let signal;
  const fetchImpl = jest.fn().mockImplementation(async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ usage: { prompt_tokens: 100, completion_tokens: 100 }, choices: [{ message: { content: '{"ok":true}' } }] }), 20);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    }) };
  });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, timeoutMs: 5 }))
    .rejects.toMatchObject({ code: 'BEDROCK_TIMEOUT' });
  expect(signal.aborted).toBe(true);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('calculates provider-reported cost including cached input at the evaluator rates', () => {
  expect(reportedCostUsd({ prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 400_000 } }))
    .toBeCloseTo(1.54);
  expect(MAX_REPORTED_COST_USD).toBe(0.25);
});

test.each([
  ['missing usage', undefined],
  ['invalid prompt usage', { prompt_tokens: -1, completion_tokens: 1 }],
  ['invalid cached usage', { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: '1' } }],
])('fails closed for %s without retrying', async (_label, usage) => {
  const fetchImpl = jest.fn().mockResolvedValue(response({ usage, choices: [{ message: { content: '{"ok":true}' } }] }));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl }))
    .rejects.toMatchObject({ code: 'BEDROCK_USAGE_UNKNOWN' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('rejects a response whose reported cost exceeds the shared ceiling', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response({
    usage: { prompt_tokens: 120_000, completion_tokens: 0 },
    choices: [{ message: { content: '{"ok":true}' } }],
  }));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl }))
    .rejects.toMatchObject({ code: 'BEDROCK_COST_LIMIT' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('rejects cached-token usage greater than prompt-token usage', () => {
  expect(reportedCostUsd({ prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 11 } })).toBeNull();
});

test('requires an explicit successful finish reason', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
    usage: { prompt_tokens: 100, completion_tokens: 100 },
    choices: [{ message: { content: '{"ok":true}' } }],
  }) });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl }))
    .rejects.toMatchObject({ code: 'BEDROCK_FINISH_REASON_INVALID' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

function streamResponse(events, { splitAt = 13 } = {}) {
  const bytes = new TextEncoder().encode(events);
  const chunks = [bytes.slice(0, splitAt), bytes.slice(splitAt)];
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'x-request-id': 'provider-123' }),
    body: new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } }),
  };
}

const sse = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
const usage = { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 10 } };

test('streams split UTF-8 and CRLF events, records safe telemetry, and returns only validated JSON', async () => {
  const telemetry = [];
  const wire = [
    sse({ marker: 'é', choices: [{ delta: { content: '{"ok":' }, finish_reason: null }] }),
    sse({ choices: [{ delta: { content: 'true}' }, finish_reason: null }] }),
    sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    sse({ choices: [], usage }),
    'data: [DONE]\r\n\r\n',
  ].join('');
  const splitAt = new TextEncoder().encode(wire).indexOf(0xc3) + 1;
  const fetchImpl = jest.fn().mockResolvedValue(streamResponse(wire, { splitAt }));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, stream: true, onEvent: e => telemetry.push(e) }))
    .resolves.toEqual({ ok: true });
  const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(requestBody).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  expect(telemetry.map(event => event.phase)).toEqual(expect.arrayContaining([
    'request_start', 'headers', 'first_body', 'first_content', 'last_content', 'body_end', 'usage', 'validated', 'complete',
  ]));
  expect(telemetry.find(event => event.phase === 'headers')).toMatchObject({ providerRequestId: 'provider-123' });
  expect(telemetry.find(event => event.phase === 'usage')).toMatchObject({ usage: { prompt_tokens: 100, completion_tokens: 20 } });
  expect(JSON.stringify(telemetry)).not.toContain('{"ok":');
});

test.each([
  ['missing usage', [sse({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'], 'BEDROCK_USAGE_UNKNOWN'],
  ['missing finish', [sse({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: null }] }), sse({ choices: [], usage }), 'data: [DONE]\n\n'], 'BEDROCK_FINISH_REASON_INVALID'],
  ['missing done marker', [sse({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'stop' }] }), sse({ choices: [], usage })], 'BEDROCK_STREAM_MISSING_DONE'],
  ['truncated finish', [sse({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'length' }] }), sse({ choices: [], usage }), 'data: [DONE]\n\n'], 'BEDROCK_OUTPUT_TRUNCATED'],
  ['provider refusal', [sse({ choices: [{ delta: { refusal: 'blocked' }, finish_reason: 'stop' }] }), sse({ choices: [], usage }), 'data: [DONE]\n\n'], 'BEDROCK_REFUSED'],
])('stream fails closed for %s', async (_label, frames, code) => {
  const fetchImpl = jest.fn().mockResolvedValue(streamResponse(frames.join('')));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, stream: true }))
    .rejects.toMatchObject({ code });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('stream timeout aborts a stalled provider body without retrying', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ start() {} }) });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, stream: true, timeoutMs: 5 }))
    .rejects.toMatchObject({ code: 'BEDROCK_TIMEOUT', status: 504 });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('stream rejects an oversized provider SSE frame before retaining it', async () => {
  const content = 'x'.repeat(2 * 1024 * 1024 + 1);
  const fetchImpl = jest.fn().mockResolvedValue(streamResponse(sse({ choices: [{ delta: { content }, finish_reason: null }] })));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, stream: true }))
    .rejects.toMatchObject({ code: 'BEDROCK_STREAM_TOO_LARGE' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('aborted analysis stream is classified as cancelled and stops provider reading', async () => {
  const cancellation = new AbortController();
  const fetchImpl = jest.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ start() {} }) });
  const pending = completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, stream: true, signal: cancellation.signal });
  setTimeout(() => cancellation.abort('CANCELLED'), 5);
  await expect(pending).rejects.toMatchObject({ code: 'BEDROCK_CANCELLED', status: 499 });
});

test('non-stream response telemetry marks the actual first body byte and bounds JSON reads', async () => {
  const body = JSON.stringify({ usage, choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] });
  const bytes = new TextEncoder().encode(body);
  const telemetry = [];
  const text = jest.fn();
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true, status: 200, headers: new Headers(),
    text,
    body: new ReadableStream({ start(controller) {
      setTimeout(() => { controller.enqueue(bytes.slice(0, 3)); controller.enqueue(bytes.slice(3)); controller.close(); }, 5);
    } }),
  });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, onEvent: event => telemetry.push(event) }))
    .resolves.toEqual({ ok: true });
  expect(telemetry.map(event => event.phase)).toEqual(expect.arrayContaining(['first_body', 'body_end', 'usage', 'first_content', 'last_content']));
  expect(telemetry.find(event => event.phase === 'first_body').elapsedMs).toBeGreaterThanOrEqual(1);
  expect(text).not.toHaveBeenCalled();
});

test('non-stream JSON body is size-limited while consuming it', async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true, status: 200, headers: new Headers(),
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); controller.close(); } }),
  });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl }))
    .rejects.toMatchObject({ code: 'BEDROCK_RESPONSE_TOO_LARGE' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
