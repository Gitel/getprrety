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
  expect(TIMEOUT_MS).toBe(45_000);
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
