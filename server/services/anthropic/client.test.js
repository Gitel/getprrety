'use strict';

const {
  MODEL, MAX_OUTPUT_TOKENS, MAX_REPORTED_COST_USD, MAX_COST_CEILING_USD,
  AnthropicError, completeJson, countTokens, reportedCostUsd,
} = require('./client');

const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };
const output = { ok: true };

function makeSdkClient({ count = { input_tokens: 100 }, message, events, streamError } = {}) {
  const sdkClient = {
    messages: {
      countTokens: jest.fn().mockResolvedValue(count),
      stream: jest.fn(() => {
        const listeners = new Map();
        const stream = {
          on(name, listener) { listeners.set(name, listener); return stream; },
          withResponse: jest.fn().mockResolvedValue({ response: { status: 200, headers: new Headers({ 'request-id': 'anthropic-123' }) }, request_id: 'anthropic-123' }),
          finalMessage: jest.fn(async () => {
            const finalMessage = message || {
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: JSON.stringify(output) }],
              usage: { input_tokens: 100, output_tokens: 20 },
            };
            const streamEvents = events || [
              { type: 'message_start', message: { usage: { input_tokens: finalMessage.usage?.input_tokens } } },
              ...finalMessage.content.filter(block => block.type === 'text').map(block => ({ type: 'content_block_delta', delta: { type: 'text_delta', text: block.text } })),
              { type: 'message_delta', delta: { stop_reason: finalMessage.stop_reason }, usage: { output_tokens: finalMessage.usage?.output_tokens } },
            ];
            for (const event of streamEvents) listeners.get('streamEvent')?.(event);
            if (streamError) throw streamError;
            return finalMessage;
          }),
        };
        return stream;
      }),
    },
  };
  return sdkClient;
}

function textDelta(text) {
  return { type: 'content_block_delta', delta: { type: 'text_delta', text } };
}

test('counts the exact Anthropic input schema and uses it for a structured stream request', async () => {
  const sdkClient = makeSdkClient();
  const telemetry = [];
  await expect(completeJson({
    system: 'system rules', messages: [{ role: 'user', content: 'hello' }], schema,
    token: 'test-key', sdkClient, onEvent: event => telemetry.push(event),
  })).resolves.toEqual(output);

  const countRequest = sdkClient.messages.countTokens.mock.calls[0][0];
  expect(countRequest).toMatchObject({
    model: MODEL,
    system: 'system rules',
    messages: [{ role: 'user', content: 'hello' }],
    output_config: { format: { type: 'json_schema', schema } },
  });
  const invokeRequest = sdkClient.messages.stream.mock.calls[0][0];
  expect(invokeRequest).toMatchObject({
    model: MODEL,
    system: 'system rules',
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: 'hello' }],
  });
  expect(sdkClient.messages.stream.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  expect(telemetry).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: 'counted', inputTokens: 100 }),
    expect.objectContaining({ phase: 'usage', usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } } }),
    expect.objectContaining({ phase: 'validated' }),
    expect.objectContaining({ phase: 'complete', finishReason: 'end_turn' }),
  ]));
  expect(JSON.stringify(telemetry)).not.toContain('{"ok":true}');
});

test('countTokens exposes a standalone schema-aware preflight result', async () => {
  const sdkClient = makeSdkClient({ count: { input_tokens: 321 } });
  await expect(countTokens({ system: 'rules', messages: [{ role: 'user', content: 'x' }], schema, token: 'test-key', sdkClient }))
    .resolves.toEqual({ inputTokens: 321 });
  expect(sdkClient.messages.countTokens).toHaveBeenCalledTimes(1);
});

test('converts validated JPEG and PNG data URLs to Anthropic base64 image blocks', async () => {
  const sdkClient = makeSdkClient();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
  await completeJson({
    system: '', schema, token: 'test-key', sdkClient,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'photo' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg}` } },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
    ] }],
  });
  expect(sdkClient.messages.countTokens.mock.calls[0][0].messages[0].content).toEqual([
    { type: 'text', text: 'photo' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
  ]);
});

test.each([
  ['bad data URL', 'data:image/gif;base64,AAAA', 'ANTHROPIC_IMAGE_INVALID'],
  ['invalid base64', 'data:image/jpeg;base64,@@==', 'ANTHROPIC_IMAGE_INVALID'],
])('rejects %s before contacting the SDK', async (_name, url, code) => {
  const sdkClient = makeSdkClient();
  await expect(completeJson({
    system: '', schema, token: 'test-key', sdkClient,
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }],
  })).rejects.toMatchObject({ code });
  expect(sdkClient.messages.countTokens).not.toHaveBeenCalled();
});

test('rejects images above the request size limit before contacting the SDK', async () => {
  const sdkClient = makeSdkClient();
  const base64 = Buffer.alloc(Math.floor(3.75 * 1024 * 1024) + 1).toString('base64');
  await expect(completeJson({
    system: '', schema, token: 'test-key', sdkClient,
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }] }],
  })).rejects.toMatchObject({ code: 'ANTHROPIC_IMAGE_TOO_LARGE' });
  expect(sdkClient.messages.countTokens).not.toHaveBeenCalled();
});

test('applies the counted input to the output cap and refuses when no output fits the cost budget', async () => {
  const sdkClient = makeSdkClient({ count: { input_tokens: 15_604 } });
  const telemetry = [];
  await completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient, onEvent: event => telemetry.push(event) });
  expect(telemetry.find(event => event.phase === 'counted')).toMatchObject({ inputTokens: 15_604, outputTokenLimit: MAX_OUTPUT_TOKENS });
  expect(telemetry.find(event => event.phase === 'counted').estimatedCostUsd).toBeLessThan(MAX_REPORTED_COST_USD);

  const tooLarge = makeSdkClient({ count: { input_tokens: 100_000 } });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient: tooLarge, maxCostUsd: 0.02 }))
    .rejects.toMatchObject({ code: 'ANTHROPIC_COST_LIMIT' });
  expect(tooLarge.messages.stream).not.toHaveBeenCalled();
});

test('enforces the caller cap and the fixed maximum against reported Anthropic usage', async () => {
  const underCallerCap = makeSdkClient({ message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 40_000, output_tokens: 2_000 } } });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient: underCallerCap, maxCostUsd: 0.5 })).resolves.toEqual(output);

  const overCallerCap = makeSdkClient({ message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 40_000, output_tokens: 2_000 } } });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient: overCallerCap, maxCostUsd: 0.05 })).rejects.toMatchObject({ code: 'ANTHROPIC_COST_LIMIT' });
  expect(MAX_COST_CEILING_USD).toBe(0.5);
});

test('reports first text arrival and cumulative input/output usage without exposing stream text', async () => {
  const sdkClient = makeSdkClient({
    events: [
      { type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      textDelta('{"ok":'),
      textDelta('true}'),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } },
    ],
  });
  const telemetry = [];
  await completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient, onEvent: event => telemetry.push(event) });
  expect(telemetry.filter(event => event.phase === 'first_content')).toHaveLength(1);
  expect(telemetry.find(event => event.phase === 'usage')).toMatchObject({
    usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
  });
  expect(JSON.stringify(telemetry)).not.toContain('{"ok":');
});

test('includes text sent in the initial content block when validating the streamed result', async () => {
  const sdkClient = makeSdkClient({
    events: [
      { type: 'content_block_start', content_block: { type: 'text', text: '{' } },
      textDelta('"ok":true}'),
    ],
    message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 100, output_tokens: 20 } },
  });
  const telemetry = [];
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient, onEvent: event => telemetry.push(event) })).resolves.toEqual(output);
  expect(telemetry.filter(event => event.phase === 'body_end').at(-1).contentBytes).toBe(Buffer.byteLength('{"ok":true}'));
});

test.each([
  ['refusal', 'refusal', 'ANTHROPIC_REFUSED'],
  ['truncated output', 'max_tokens', 'ANTHROPIC_OUTPUT_TRUNCATED'],
  ['tool stop', 'tool_use', 'ANTHROPIC_FINISH_REASON_INVALID'],
])('rejects %s responses', async (_name, stop_reason, code) => {
  const sdkClient = makeSdkClient({ message: { stop_reason, content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 100, output_tokens: 20 } } });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient })).rejects.toMatchObject({ code });
});

test('validates wire JSON before hydration and canonical output after hydration', async () => {
  const wireSchema = { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } };
  const hydrateOutput = jest.fn(value => ({ ok: value.value === 'x' }));
  const sdkClient = makeSdkClient({ message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"value":"x"}' }], usage: { input_tokens: 100, output_tokens: 20 } } });
  await expect(completeJson({ system: '', messages: [], schema, wireSchema, hydrateOutput, token: 'test-key', sdkClient })).resolves.toEqual(output);
  expect(hydrateOutput).toHaveBeenCalledWith({ value: 'x' });

  const invalidWire = makeSdkClient({ message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"value":1}' }], usage: { input_tokens: 100, output_tokens: 20 } } });
  await expect(completeJson({ system: '', messages: [], schema, wireSchema, hydrateOutput, token: 'test-key', sdkClient: invalidWire })).rejects.toMatchObject({ code: 'ANTHROPIC_WIRE_SCHEMA_INVALID' });

  const invalidCanonical = makeSdkClient({ message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":"yes"}' }], usage: { input_tokens: 100, output_tokens: 20 } } });
  await expect(completeJson({
    system: '', messages: [], schema, token: 'test-key', sdkClient: invalidCanonical,
    wireSchema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'string' } } },
  })).rejects.toMatchObject({ code: 'ANTHROPIC_SCHEMA_INVALID' });
});

test('bounds final text size and rejects invalid or empty JSON', async () => {
  const tooLarge = makeSdkClient({ message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024 + 1) }], usage: { input_tokens: 100, output_tokens: 20 } } });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient: tooLarge })).rejects.toMatchObject({ code: 'ANTHROPIC_RESPONSE_TOO_LARGE' });

  for (const text of ['', 'not json']) {
    const sdkClient = makeSdkClient({ message: { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 20 } } });
    await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient })).rejects.toMatchObject({ code: text ? 'ANTHROPIC_INVALID_JSON' : 'ANTHROPIC_INVALID_RESPONSE' });
  }
});

test('times out the whole count and stream operation and cancels when the caller aborts', async () => {
  const stuckCount = makeSdkClient();
  stuckCount.messages.countTokens.mockImplementation((_request, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'APIUserAbortError' })), { once: true });
  }));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient: stuckCount, timeoutMs: 5 }))
    .rejects.toMatchObject({ code: 'ANTHROPIC_TIMEOUT', status: 504 });
  expect(stuckCount.messages.stream).not.toHaveBeenCalled();

  const stuckStreamTimeout = makeSdkClient();
  stuckStreamTimeout.messages.stream.mockImplementation((_request, { signal }) => ({
    on: () => {},
    withResponse: async () => ({ response: { status: 200, headers: new Headers() }, request_id: null }),
    finalMessage: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'APIUserAbortError' })), { once: true })),
  }));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient: stuckStreamTimeout, timeoutMs: 5 }))
    .rejects.toMatchObject({ code: 'ANTHROPIC_TIMEOUT', status: 504 });

  const stuckStream = makeSdkClient();
  stuckStream.messages.stream.mockImplementation((_request, { signal }) => ({
    on: () => {},
    withResponse: async () => ({ response: { status: 200, headers: new Headers() }, request_id: null }),
    finalMessage: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'APIUserAbortError' })), { once: true })),
  }));
  const cancellation = new AbortController();
  const pending = completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient: stuckStream, signal: cancellation.signal });
  setTimeout(() => cancellation.abort('CANCELLED'), 5);
  await expect(pending).rejects.toMatchObject({ code: 'ANTHROPIC_CANCELLED', status: 499 });

  const cancelledCount = makeSdkClient();
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort('CANCELLED');
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient: cancelledCount, signal: alreadyCancelled.signal }))
    .rejects.toMatchObject({ code: 'ANTHROPIC_CANCELLED', status: 499 });
  expect(cancelledCount.messages.countTokens).not.toHaveBeenCalled();
});

test('maps provider errors to fixed codes, never retries, and does not expose raw messages', async () => {
  const sdkClient = makeSdkClient({ streamError: Object.assign(new Error('private provider body'), { status: 429 }) });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient }))
    .rejects.toMatchObject({ code: 'ANTHROPIC_HTTP_429', message: 'Analysis provider failed' });
  expect(sdkClient.messages.countTokens).toHaveBeenCalledTimes(1);
  expect(sdkClient.messages.stream).toHaveBeenCalledTimes(1);

  const missingKey = makeSdkClient();
  await expect(completeJson({ system: '', messages: [], schema, token: '', sdkClient: missingKey }))
    .rejects.toMatchObject({ code: 'ANTHROPIC_NOT_CONFIGURED', status: 503 });
  expect(missingKey.messages.countTokens).not.toHaveBeenCalled();
});

test('fails closed on unknown or unsupported cached usage', () => {
  expect(reportedCostUsd({ inputTokens: 1_000_000, outputTokens: 0 })).toBe(4);
  expect(reportedCostUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 1 })).toBeNull();
  expect(reportedCostUsd(null)).toBeNull();
  expect(MAX_REPORTED_COST_USD).toBe(0.25);
  expect(new AnthropicError('ANTHROPIC_HTTP_429').message).toBe('Analysis provider failed');
});

test('accepts nullable SDK cache counters as zero for successful uncached usage', async () => {
  const sdkClient = makeSdkClient({
    message: {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"ok":true}' }],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: null, cache_creation_input_tokens: null },
    },
  });
  const telemetry = [];
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-key', sdkClient, onEvent: event => telemetry.push(event) })).resolves.toEqual(output);
  expect(telemetry.find(event => event.phase === 'usage')).toMatchObject({
    usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } },
    costUsd: 0.0008,
  });
});

function sdkSseEvent(type, value) { return `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`; }

test('official SDK sends authenticated count and structured stream requests through mocked fetch', async () => {
  const requests = [];
  const fetchImpl = jest.fn(async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/count_tokens')) return new Response(JSON.stringify({ input_tokens: 100 }), { status: 200, headers: { 'content-type': 'application/json' } });
    const events = [
      sdkSseEvent('message_start', { type: 'message_start', message: { id: 'msg-test', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } }),
      sdkSseEvent('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      sdkSseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"ok":true}' } }),
      sdkSseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }),
      sdkSseEvent('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }),
      sdkSseEvent('message_stop', { type: 'message_stop' }),
    ].join('');
    return new Response(events, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'sdk-request-id' } });
  });

  await expect(completeJson({ system: 'rules', messages: [{ role: 'user', content: 'hello' }], schema, token: 'sdk-test-key', fetchImpl }))
    .resolves.toEqual(output);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(requests[0].url).toContain('/v1/messages/count_tokens');
  expect(requests[0].options.headers.get('x-api-key')).toBe('sdk-test-key');
  expect(JSON.parse(requests[0].options.body)).toMatchObject({
    model: MODEL,
    output_config: { format: { type: 'json_schema', schema } },
  });
  expect(requests[1].url).toContain('/v1/messages');
  expect(JSON.parse(requests[1].options.body)).toMatchObject({
    model: MODEL, stream: true, max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { format: { type: 'json_schema', schema } },
  });
});

test('official SDK does not retry a provider error and hides its response text', async () => {
  const requests = [];
  const fetchImpl = jest.fn(async (url) => {
    requests.push(String(url));
    if (String(url).includes('/count_tokens')) return new Response(JSON.stringify({ input_tokens: 100 }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'private response body' } }), { status: 429, headers: { 'content-type': 'application/json' } });
  });
  await expect(completeJson({ system: '', messages: [], schema, token: 'sdk-test-key', fetchImpl }))
    .rejects.toMatchObject({ code: 'ANTHROPIC_HTTP_429', message: 'Analysis provider failed' });
  expect(requests).toHaveLength(2);
  expect(requests[1]).toContain('/v1/messages');
});
