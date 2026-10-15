'use strict';

const { EventStreamCodec } = require('@smithy/eventstream-codec');
const { toUtf8, fromUtf8 } = require('@smithy/util-utf8');
const { completeJson, BASE_URL, MODEL, TIMEOUT_MS, MAX_OUTPUT_TOKENS, MAX_REPORTED_COST_USD, MAX_COST_CEILING_USD, reportedCostUsd, makeWireSchema } = require('./client');

const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };
const result = { ok: true };
const jsonResponse = value => ({ ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close(); } }) });
const countBody = inputTokens => ({ inputTokens });
const converseBody = (content = result, extra = {}) => ({
  usage: { inputTokens: 100, outputTokens: 20 }, stopReason: 'end_turn',
  output: { message: { content: [{ text: JSON.stringify(content) }] } }, ...extra,
});
function mockFetch(...responses) { return jest.fn().mockImplementation(async () => responses.shift()); }

function eventFrame(eventType, value) {
  const codec = new EventStreamCodec(toUtf8, fromUtf8);
  const body = new TextEncoder().encode(JSON.stringify(value));
  return codec.encode({ headers: { ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: eventType }, ':content-type': { type: 'string', value: 'application/json' } }, body });
}

function streamResponse(frames, splitAt = 11) {
  const bytes = Buffer.concat(frames.map(frame => Buffer.from(frame)));
  return { ok: true, status: 200, headers: new Headers({ 'x-amzn-requestid': 'aws-request-123' }), body: new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, splitAt)); controller.enqueue(bytes.slice(splitAt)); controller.close();
  } }) };
}

test('uses native Runtime CountTokens and Converse APIs with capped output and explicit bearer auth', async () => {
  const fetchImpl = mockFetch(jsonResponse(countBody(100)), jsonResponse(converseBody()));
  await expect(completeJson({ system: 'rules', messages: [{ role: 'user', content: 'input' }], schema, token: 'test-token', fetchImpl }))
    .resolves.toEqual(result);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  const [countUrl, countOptions] = fetchImpl.mock.calls[0];
  expect(countUrl).toBe(`${BASE_URL}/model/anthropic.claude-opus-4-6-v1/count-tokens`);
  expect(countOptions.headers.Authorization).toBe('Bearer test-token');
  expect(JSON.parse(countOptions.body)).toMatchObject({ input: { converse: { additionalModelRequestFields: { output_config: { format: { type: 'json_schema', schema } } } } } });
  const [invokeUrl, invokeOptions] = fetchImpl.mock.calls[1];
  expect(invokeUrl).toBe(`${BASE_URL}/model/${encodeURIComponent(MODEL)}/converse`);
  expect(JSON.parse(invokeOptions.body)).toMatchObject({ inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS }, outputConfig: { textFormat: { type: 'json_schema', structure: { jsonSchema: { schema: JSON.stringify(schema) } } } }, messages: [{ role: 'user', content: [{ text: 'input' }] }] });
  expect(TIMEOUT_MS).toBe(90_000);
});

test('uses one whole-operation deadline for token counting and does not invoke if count hangs', async () => {
  const fetchImpl = jest.fn().mockImplementation((_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, timeoutMs: 5 }))
    .rejects.toMatchObject({ code: 'BEDROCK_TIMEOUT', status: 504 });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('preflight rejects unknown counts and keeps estimate below the shared cost ceiling', async () => {
  const noCount = mockFetch(jsonResponse({}));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl: noCount })).rejects.toMatchObject({ code: 'BEDROCK_COUNT_UNKNOWN' });
  expect(noCount).toHaveBeenCalledTimes(1);
  const fetchImpl = mockFetch(jsonResponse(countBody(15_604)), jsonResponse(converseBody()));
  const events = [];
  await completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, maxOutputTokens: 8_000, onEvent: event => events.push(event) });
  expect(events.find(event => event.phase === 'counted')).toMatchObject({ inputTokens: 15_604, outputTokenLimit: 5_580 });
  expect(events.find(event => event.phase === 'counted').estimatedCostUsd).toBeLessThan(MAX_REPORTED_COST_USD);
});

test('converts images without dropping them and rejects images above the REST request limit', async () => {
  const fetchImpl = mockFetch(jsonResponse(countBody(20)), jsonResponse(converseBody()));
  await completeJson({ system: '', messages: [{ role: 'user', content: [{ type: 'text', text: 'photo' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from('img').toString('base64')}` } }] }], schema, token: 'test-token', fetchImpl });
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body).input.converse.messages[0].content[1].image.source.bytes).toBe(Buffer.from('img').toString('base64'));
  const tooLarge = Buffer.alloc(Math.floor(3.75 * 1024 * 1024) + 1).toString('base64');
  const unused = jest.fn();
  await expect(completeJson({ system: '', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${tooLarge}` } }] }], schema, token: 'test-token', fetchImpl: unused })).rejects.toMatchObject({ code: 'BEDROCK_IMAGE_TOO_LARGE' });
  expect(unused).not.toHaveBeenCalled();
});

test('validates Bedrock JSON against wire then hydrated canonical schemas', async () => {
  const wireSchema = { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } };
  const fetchImpl = mockFetch(jsonResponse(countBody(10)), jsonResponse(converseBody({ value: 'x' })));
  const hydrateOutput = jest.fn(value => ({ ok: value.value === 'x' }));
  await expect(completeJson({ system: '', messages: [], schema, wireSchema, hydrateOutput, token: 'test-token', fetchImpl })).resolves.toEqual(result);
  expect(hydrateOutput).toHaveBeenCalledWith({ value: 'x' });
  const badWire = mockFetch(jsonResponse(countBody(10)), jsonResponse(converseBody({ value: 1 })));
  await expect(completeJson({ system: '', messages: [], schema, wireSchema, hydrateOutput, token: 'test-token', fetchImpl: badWire })).rejects.toMatchObject({ code: 'BEDROCK_WIRE_SCHEMA_INVALID' });
});

test('stream decodes split EventStream frames, validates EOF, stop and metadata, and reports sanitized usage', async () => {
  const telemetry = [];
  const frames = [
    eventFrame('messageStart', { role: 'assistant' }),
    eventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: '{"ok":' } }),
    eventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: 'true}' } }),
    eventFrame('messageStop', { stopReason: 'end_turn' }),
    eventFrame('metadata', { usage: { inputTokens: 100, outputTokens: 20 } }),
  ];
  const fetchImpl = mockFetch(jsonResponse(countBody(100)), streamResponse(frames));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, stream: true, onEvent: event => telemetry.push(event) })).resolves.toEqual(result);
  expect(fetchImpl.mock.calls[1][0]).toBe(`${BASE_URL}/model/${encodeURIComponent(MODEL)}/converse-stream`);
  expect(fetchImpl.mock.calls[1][1].headers.Accept).toBe('application/vnd.amazon.eventstream');
  expect(telemetry).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'counted' }), expect.objectContaining({ phase: 'usage', usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } } }), expect.objectContaining({ phase: 'validated' })]));
  expect(JSON.stringify(telemetry)).not.toContain('{"ok":');
});

test.each([
  ['missing metadata', [{ type: 'messageStart', value: { role: 'assistant' } }, { type: 'messageStop', value: { stopReason: 'end_turn' } }], 'BEDROCK_STREAM_INCOMPLETE'],
  ['missing stop', [{ type: 'messageStart', value: { role: 'assistant' } }, { type: 'metadata', value: { usage: { inputTokens: 10, outputTokens: 1 } } }], 'BEDROCK_STREAM_INVALID_ORDER'],
  ['truncated output', [{ type: 'messageStart', value: { role: 'assistant' } }, { type: 'messageStop', value: { stopReason: 'max_tokens' } }, { type: 'metadata', value: { usage: { inputTokens: 10, outputTokens: 1 } } }], 'BEDROCK_OUTPUT_TRUNCATED'],
])('fails closed when native stream has %s', async (_name, events, code) => {
  const frames = events.map(event => eventFrame(event.type, event.value));
  const fetchImpl = mockFetch(jsonResponse(countBody(10)), streamResponse(frames));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, stream: true })).rejects.toMatchObject({ code });
});

test('cancels a pending native stream read when the caller disconnects', async () => {
  const startFrame = eventFrame('messageStart', { role: 'assistant' });
  const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse(countBody(10))).mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(controller) { controller.enqueue(startFrame); } }) });
  const cancellation = new AbortController();
  const pending = completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, stream: true, signal: cancellation.signal });
  setTimeout(() => cancellation.abort('CANCELLED'), 5);
  await expect(pending).rejects.toMatchObject({ code: 'BEDROCK_CANCELLED', status: 499 });
});

test('rejects bad EventStream CRCs and retains already received usage telemetry', async () => {
  const good = [eventFrame('messageStart', { role: 'assistant' }), eventFrame('messageStop', { stopReason: 'end_turn' }), eventFrame('metadata', { usage: { inputTokens: 100, outputTokens: 20 } })];
  const corrupted = Buffer.from(eventFrame('messageStart', { role: 'assistant' }));
  corrupted[corrupted.length - 1] ^= 0xff;
  const bytes = Buffer.concat([...good, corrupted].map(frame => Buffer.from(frame)));
  const telemetry = [];
  const fetchImpl = mockFetch(jsonResponse(countBody(10)), { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, stream: true, onEvent: event => telemetry.push(event) })).rejects.toMatchObject({ code: 'BEDROCK_STREAM_FRAME_INVALID' });
  expect(telemetry.find(event => event.phase === 'usage')).toMatchObject({ usage: { prompt_tokens: 100, completion_tokens: 20 } });
});

test('rejects a response that exceeds the reported-cost ceiling after recording its usage', async () => {
  const fetchImpl = mockFetch(jsonResponse(countBody(10)), jsonResponse(converseBody(result, { usage: { inputTokens: 40_000, outputTokens: 2_000 } })));
  const telemetry = [];
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, onEvent: event => telemetry.push(event) })).rejects.toMatchObject({ code: 'BEDROCK_COST_LIMIT' });
  expect(telemetry.find(event => event.phase === 'usage')).toMatchObject({ usage: { prompt_tokens: 40_000, completion_tokens: 2_000 }, costUsd: 0.275 });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('maps refusals and provider errors to safe fixed codes without retrying', async () => {
  const refusal = mockFetch(jsonResponse(countBody(10)), jsonResponse(converseBody(result, { stopReason: 'guardrail_intervened' })));
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl: refusal })).rejects.toMatchObject({ code: 'BEDROCK_REFUSED' });
  const failed = jest.fn().mockResolvedValue({ ok: false, status: 429, headers: new Headers(), body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('private details')); controller.close(); } }) });
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl: failed })).rejects.toMatchObject({ code: 'BEDROCK_HTTP_429', message: 'Analysis provider failed' });
  expect(failed).toHaveBeenCalledTimes(1);
});

test('usage pricing fails closed for unsupported prompt cache usage', () => {
  expect(reportedCostUsd({ inputTokens: 1_000_000, outputTokens: 0 })).toBe(5.5);
  expect(reportedCostUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 1 })).toBeNull();
  expect(MAX_REPORTED_COST_USD).toBe(0.25);
  expect(makeWireSchema({ type: 'string', maxLength: 10 })).toEqual({ type: 'string' });
});

test('does not call provider when token is missing or cancellation precedes count', async () => {
  const fetchImpl = jest.fn();
  await expect(completeJson({ system: '', messages: [], schema, token: '', fetchImpl })).rejects.toMatchObject({ code: 'BEDROCK_NOT_CONFIGURED', status: 503 });
  const controller = new AbortController(); controller.abort('CANCELLED');
  await expect(completeJson({ system: '', messages: [], schema, token: 'test-token', fetchImpl, signal: controller.signal })).rejects.toMatchObject({ code: 'BEDROCK_CANCELLED', status: 499 });
  expect(fetchImpl).not.toHaveBeenCalled();
});

// maxCostUsd (admin AI settings) replaces the 0.25 default, but never goes above the 0.50 code ceiling.
test('maxCostUsd raises or lowers the per-request cost cap and is clamped to the 0.50 ceiling', async () => {
  const run = (usage, maxCostUsd) => completeJson({
    system: '', messages: [], schema, token: 'test-token', maxCostUsd,
    fetchImpl: mockFetch(jsonResponse(countBody(10)), jsonResponse(converseBody(result, { usage }))),
  });
  // 0.275 USD of usage: over the 0.25 default, fine under a 0.50 cap.
  await expect(run({ inputTokens: 40_000, outputTokens: 2_000 }, 0.5)).resolves.toEqual(result);
  // 0.055 USD of usage: fine by default, over a 0.05 cap.
  await expect(run({ inputTokens: 5_000, outputTokens: 1_000 })).resolves.toEqual(result);
  await expect(run({ inputTokens: 5_000, outputTokens: 1_000 }, 0.05)).rejects.toMatchObject({ code: 'BEDROCK_COST_LIMIT' });
  // 0.55 USD of usage: a 5 USD request is clamped to the 0.50 ceiling, so it still fails.
  await expect(run({ inputTokens: 100_000, outputTokens: 0 }, 5)).rejects.toMatchObject({ code: 'BEDROCK_COST_LIMIT' });
  expect(MAX_COST_CEILING_USD).toBe(0.5);
});
