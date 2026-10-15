'use strict';

const Ajv = require('ajv');
const { EventStreamCodec } = require('@smithy/eventstream-codec');
const { toUtf8, fromUtf8 } = require('@smithy/util-utf8');
const { MAX_SSE_CONTENT_BYTES } = require('./sse');
const { makeWireSchema } = require('./wireSchema');

const REGION = 'us-east-1';
const BASE_URL = `https://bedrock-runtime.${REGION}.amazonaws.com`;
const MODEL = 'us.anthropic.claude-opus-4-6-v1';
const COUNT_MODEL = 'anthropic.claude-opus-4-6-v1';
const TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 8_000;
const MAX_REPORTED_COST_USD = 0.25;
// Hard code ceiling for the per-request cost cap, whatever the admin AI settings say.
const MAX_COST_CEILING_USD = 0.50;
const RESERVED_COST_USD = 0.01;
const INPUT_ALLOWANCE_TOKENS = 128;
const INPUT_USD_PER_MILLION = 5.5;
const OUTPUT_USD_PER_MILLION = 27.5;
const MAX_EVENT_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = Math.floor(3.75 * 1024 * 1024);

function isSafeTokenCount(value) { return Number.isSafeInteger(value) && value >= 0; }

// Provider usage is represented in the existing telemetry shape to avoid leaking provider-specific fields.
function normalizeUsage(usage) {
  if (!isSafeTokenCount(usage?.inputTokens) || !isSafeTokenCount(usage?.outputTokens)) return null;
  for (const key of ['cacheReadInputTokens', 'cacheWriteInputTokens']) {
    if (Object.hasOwn(usage, key) && (!isSafeTokenCount(usage[key]) || usage[key] !== 0)) return null;
  }
  return { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, prompt_tokens_details: { cached_tokens: 0 } };
}

function reportedCostUsd(usage) {
  let normalized = usage?.inputTokens === undefined ? usage : normalizeUsage(usage);
  if (usage?.inputTokens === undefined && usage?.prompt_tokens !== undefined) {
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    if (cached !== 0) return null;
    normalized = { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, prompt_tokens_details: { cached_tokens: 0 } };
  }
  if (!normalized || !isSafeTokenCount(normalized.prompt_tokens) || !isSafeTokenCount(normalized.completion_tokens) || normalized.prompt_tokens_details?.cached_tokens !== 0) return null;
  return (normalized.prompt_tokens * INPUT_USD_PER_MILLION + normalized.completion_tokens * OUTPUT_USD_PER_MILLION) / 1_000_000;
}

function safeUsage(usage) { return normalizeUsage(usage); }
function isConfigured() { return Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK); }

class BedrockError extends Error {
  constructor(code, status = 502) {
    super(code === 'BEDROCK_NOT_CONFIGURED' ? 'Analysis service is unavailable' : 'Analysis provider failed');
    this.name = 'BedrockError'; this.code = code; this.status = status;
  }
}

function emit(onEvent, event) {
  if (typeof onEvent !== 'function') return;
  try { onEvent(event); } catch { /* Telemetry callbacks must never alter request behavior. */ }
}

function providerRequestId(response) {
  const value = response.headers?.get?.('x-amzn-requestid') || response.headers?.get?.('x-amzn-request-id');
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function throwIfAborted(signal) {
  if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
}

function formatInputContent(messages) {
  return messages.map(message => ({
    role: message.role,
    content: typeof message.content === 'string' ? [{ text: message.content }] : message.content.map(part => {
      if (part?.type === 'text' && typeof part.text === 'string') return { text: part.text };
      if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
        const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.image_url.url);
        if (!match || match[2].length % 4 !== 0) throw new BedrockError('BEDROCK_IMAGE_INVALID');
        const bytes = Buffer.from(match[2], 'base64');
        if (bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) throw new BedrockError('BEDROCK_IMAGE_TOO_LARGE');
        return { image: { format: match[1] === 'image/png' ? 'png' : 'jpeg', source: { bytes: match[2] } } };
      }
      throw new BedrockError('BEDROCK_INPUT_INVALID');
    }),
  }));
}

function requestFields(system, messages, wireSchema, maxTokens) {
  return {
    system: [{ text: system }],
    messages: formatInputContent(messages),
    inferenceConfig: { maxTokens },
    additionalModelRequestFields: { output_config: { format: { type: 'json_schema', schema: wireSchema } } },
  };
}

function validateJson(content, schema, codePrefix) {
  if (typeof content !== 'string') throw new BedrockError('BEDROCK_INVALID_RESPONSE');
  let output;
  try { output = JSON.parse(content); } catch { throw new BedrockError('BEDROCK_INVALID_JSON'); }
  const validator = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
  if (!validator(output)) throw new BedrockError(`${codePrefix}_SCHEMA_INVALID`);
  return output;
}

async function readBoundedJson(response, signal, onFirstByte, onBodyEnd) {
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0; let text = ''; let firstByteSeen = false;
  const abortReader = () => reader.cancel().catch(() => {});
  signal.addEventListener('abort', abortReader, { once: true });
  try {
    while (true) {
      throwIfAborted(signal); const { value, done } = await reader.read(); throwIfAborted(signal); if (done) break;
      bytes += value.byteLength; if (bytes > MAX_SSE_CONTENT_BYTES) throw new BedrockError('BEDROCK_RESPONSE_TOO_LARGE');
      if (!firstByteSeen && value.byteLength) { firstByteSeen = true; onFirstByte?.(); }
      try { text += decoder.decode(value, { stream: true }); } catch { throw new BedrockError('BEDROCK_INVALID_RESPONSE'); }
    }
    try { text += decoder.decode(); } catch { throw new BedrockError('BEDROCK_INVALID_RESPONSE'); }
    onBodyEnd?.(bytes);
    try { return JSON.parse(text); } catch { throw new BedrockError('BEDROCK_INVALID_RESPONSE'); }
  } finally { signal.removeEventListener('abort', abortReader); await reader.cancel().catch(() => {}); reader.releaseLock?.(); }
}

async function readProviderError(response, signal) {
  if (!response.body?.getReader) return '';
  try { return JSON.stringify(await readBoundedJson(response, signal)); } catch { return ''; }
}

function httpError(response, body) {
  if (response.status === 400 && /grammar.{0,32}too large|too large.{0,32}grammar/i.test(body)) return new BedrockError('BEDROCK_GRAMMAR_TOO_LARGE');
  return new BedrockError(`BEDROCK_HTTP_${response.status}`);
}

function frameError(headers, body) {
  const exception = headers[':exception-type']?.value;
  if (exception) {
    const safeType = String(exception).replace(/[^A-Za-z0-9]/g, '').slice(0, 48).toUpperCase();
    throw new BedrockError(`BEDROCK_${safeType || 'STREAM_EXCEPTION'}`);
  }
  const eventType = headers[':event-type']?.value;
  if (!['messageStart', 'contentBlockStart', 'contentBlockDelta', 'contentBlockStop', 'messageStop', 'metadata'].includes(eventType)) throw new BedrockError('BEDROCK_STREAM_INVALID_EVENT');
  try { return { type: eventType, value: JSON.parse(toUtf8(body)) }; } catch { throw new BedrockError('BEDROCK_STREAM_INVALID_EVENT'); }
}

// Decode arbitrary transport chunks into bounded AWS EventStream messages; the Smithy codec verifies both CRCs.
async function readEventStream(response, onEvent, signal, onFirstByte, onBodyEnd) {
  if (!response.body?.getReader) throw new BedrockError('BEDROCK_STREAM_UNAVAILABLE');
  const reader = response.body.getReader(); const codec = new EventStreamCodec(toUtf8, fromUtf8);
  let pending = new Uint8Array(0); let totalBytes = 0; let ended = false; let sourceDone = false;
  const concat = (left, right) => { const result = new Uint8Array(left.length + right.length); result.set(left); result.set(right, left.length); return result; };
  const abortReader = () => reader.cancel().catch(() => {});
  signal.addEventListener('abort', abortReader, { once: true });
  try {
    while (!ended) {
      throwIfAborted(signal);
      const { value, done } = await reader.read();
      throwIfAborted(signal);
      if (done) { sourceDone = true; break; }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SSE_CONTENT_BYTES) throw new BedrockError('BEDROCK_STREAM_TOO_LARGE');
      if (totalBytes === value.byteLength) onFirstByte?.();
      pending = concat(pending, value);
      while (pending.length >= 12) {
        const frameLength = new DataView(pending.buffer, pending.byteOffset, pending.byteLength).getUint32(0, false);
        if (frameLength < 16 || frameLength > MAX_EVENT_FRAME_BYTES) throw new BedrockError('BEDROCK_STREAM_FRAME_INVALID');
        if (pending.length < frameLength) break;
        let decoded;
        try { decoded = codec.decode(pending.subarray(0, frameLength)); } catch { throw new BedrockError('BEDROCK_STREAM_FRAME_INVALID'); }
        pending = pending.slice(frameLength);
        const event = frameError(decoded.headers, decoded.body);
        await onEvent(event);
      }
    }
    if (pending.length) throw new BedrockError('BEDROCK_STREAM_INCOMPLETE_FRAME');
    if (!sourceDone) throw new BedrockError('BEDROCK_STREAM_INCOMPLETE');
    onBodyEnd?.(totalBytes);
  } finally { signal.removeEventListener('abort', abortReader); await reader.cancel().catch(() => {}); reader.releaseLock?.(); }
}

function mapUsage(usage) {
  if (!usage || !isSafeTokenCount(usage.inputTokens) || !isSafeTokenCount(usage.outputTokens)) throw new BedrockError('BEDROCK_USAGE_UNKNOWN');
  // Prompt caching is disabled. If Bedrock reports cached usage anyway, cost cannot be safely priced here.
  for (const key of ['cacheReadInputTokens', 'cacheWriteInputTokens']) {
    if (Object.hasOwn(usage, key) && usage[key] !== 0) throw new BedrockError('BEDROCK_USAGE_UNKNOWN');
  }
  return usage;
}

// Count, preflight the price ceiling, invoke once, then validate wire and canonical output without exposing partial JSON.
async function completeJson({ system, messages, schema, schemaName = 'skin_analysis', maxOutputTokens = MAX_OUTPUT_TOKENS, maxCostUsd = MAX_REPORTED_COST_USD, token = process.env.AWS_BEARER_TOKEN_BEDROCK, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, signal, stream = false, onEvent, wireSchema, hydrateOutput }) {
  if (!token) throw new BedrockError('BEDROCK_NOT_CONFIGURED', 503);
  const controller = new AbortController(); const startedAt = Date.now(); const expiresAt = startedAt + timeoutMs; const elapsed = () => Date.now() - startedAt;
  // Per-request cost cap: the caller's value (admin AI settings), never above the code ceiling.
  const costLimitUsd = Math.min(MAX_COST_CEILING_USD, Number.isFinite(maxCostUsd) && maxCostUsd > 0 ? maxCostUsd : MAX_REPORTED_COST_USD);
  const timer = setTimeout(() => controller.abort('TIMEOUT'), timeoutMs);
  const onAbort = () => controller.abort(signal.reason || 'CANCELLED');
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  let count = 0; let cap = 0; let invocationUsage; let content = ''; let stopReason; let refusal = false; let firstContent = false; let lastContentElapsed;
  const checkDeadline = () => {
    throwIfAborted(controller.signal);
    if (Date.now() >= expiresAt) { controller.abort('TIMEOUT'); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }
  };
  const post = async (path, body, accept = 'application/json') => {
    checkDeadline();
    const response = await fetchImpl(`${BASE_URL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: accept }, body: JSON.stringify(body), signal: controller.signal });
    emit(onEvent, { phase: 'headers', elapsedMs: elapsed(), ...(response.status ? { status: response.status } : {}), ...(providerRequestId(response) ? { providerRequestId: providerRequestId(response) } : {}) });
    throwIfAborted(controller.signal);
    if (!response.ok) throw httpError(response, await readProviderError(response, controller.signal));
    return response;
  };
  emit(onEvent, { phase: 'request_start', elapsedMs: 0 });
  try {
    const boundedMax = Math.min(MAX_OUTPUT_TOKENS, Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : MAX_OUTPUT_TOKENS);
    const wire = wireSchema || makeWireSchema(schema);
    const outputFormat = { type: 'json_schema', schema: wire };
    const fields = requestFields(system, messages, wire, 1);
    const countResponse = await post(`/model/${encodeURIComponent(COUNT_MODEL)}/count-tokens`, {
      input: { converse: { system: fields.system, messages: fields.messages, additionalModelRequestFields: { output_config: { format: outputFormat } } } },
    });
    const countResult = await readBoundedJson(countResponse, controller.signal, () => emit(onEvent, { phase: 'first_body', elapsedMs: elapsed() }), bytes => emit(onEvent, { phase: 'body_end', elapsedMs: elapsed(), contentBytes: bytes }));
    checkDeadline();
    if (!isSafeTokenCount(countResult.inputTokens) || countResult.inputTokens < 1) throw new BedrockError('BEDROCK_COUNT_UNKNOWN');
    count = countResult.inputTokens;
    const estimatedInput = count + INPUT_ALLOWANCE_TOKENS;
    cap = Math.min(boundedMax, Math.floor((costLimitUsd - RESERVED_COST_USD - estimatedInput * INPUT_USD_PER_MILLION / 1_000_000) * 1_000_000 / OUTPUT_USD_PER_MILLION));
    if (cap < 1) throw new BedrockError('BEDROCK_COST_LIMIT');
    const estimatedCostUsd = (estimatedInput * INPUT_USD_PER_MILLION + cap * OUTPUT_USD_PER_MILLION) / 1_000_000 + RESERVED_COST_USD;
    emit(onEvent, { phase: 'counted', elapsedMs: elapsed(), inputTokens: count, outputTokenLimit: cap, estimatedCostUsd });

    const invokeFields = requestFields(system, messages, wire, cap);
    const path = `/model/${encodeURIComponent(MODEL)}/${stream ? 'converse-stream' : 'converse'}`;
    const body = { system: invokeFields.system, messages: invokeFields.messages, inferenceConfig: invokeFields.inferenceConfig, outputConfig: { textFormat: { type: 'json_schema', structure: { jsonSchema: { name: schemaName, schema: JSON.stringify(wire) } } } } };
    checkDeadline();
    const response = await post(path, body, stream ? 'application/vnd.amazon.eventstream' : 'application/json');
    if (stream) {
      let bodyEnd = false;
      let sawStart = false; let sawStop = false; let sawMetadata = false;
      await readEventStream(response, event => {
        if (event.type === 'metadata') {
          if (sawMetadata || !sawStop) throw new BedrockError('BEDROCK_STREAM_INVALID_ORDER');
          sawMetadata = true;
          invocationUsage = mapUsage(event.value.usage);
          emit(onEvent, { phase: 'usage', elapsedMs: elapsed(), usage: safeUsage(invocationUsage), costUsd: reportedCostUsd(invocationUsage) });
          return;
        }
        const data = event.value;
        if (event.type === 'messageStart') {
          if (sawStart || sawStop || data.role !== 'assistant') throw new BedrockError('BEDROCK_STREAM_INVALID_ORDER');
          sawStart = true;
          return;
        }
        if (event.type === 'messageStop') {
          if (!sawStart || sawStop || !data.stopReason) throw new BedrockError('BEDROCK_STREAM_INVALID_ORDER');
          sawStop = true; stopReason = data.stopReason;
          refusal = ['guardrail_intervened', 'content_filtered'].includes(stopReason);
          return;
        }
        if (sawStop || !sawStart) throw new BedrockError('BEDROCK_STREAM_INVALID_ORDER');
        if (event.type === 'contentBlockDelta') {
          if (!data.delta || typeof data.delta.text !== 'string' || Object.keys(data.delta).some(key => key !== 'text')) throw new BedrockError('BEDROCK_STREAM_CONTENT_INVALID');
          if (!data.delta.text) return;
          const delta = data.delta.text; content += delta;
          if (Buffer.byteLength(content, 'utf8') > MAX_SSE_CONTENT_BYTES) throw new BedrockError('BEDROCK_STREAM_TOO_LARGE');
          lastContentElapsed = elapsed();
          if (!firstContent) { firstContent = true; emit(onEvent, { phase: 'first_content', elapsedMs: elapsed(), contentBytes: Buffer.byteLength(content) }); }
        }
      }, controller.signal, () => emit(onEvent, { phase: 'first_body', elapsedMs: elapsed() }), bytes => {
        bodyEnd = true;
        if (content) emit(onEvent, { phase: 'last_content', elapsedMs: lastContentElapsed, contentBytes: Buffer.byteLength(content) });
        emit(onEvent, { phase: 'body_end', elapsedMs: elapsed(), contentBytes: bytes });
      });
      if (!bodyEnd) throw new BedrockError('BEDROCK_STREAM_INCOMPLETE');
      if (!sawStop || !sawMetadata) throw new BedrockError('BEDROCK_STREAM_INCOMPLETE');
    } else {
      const data = await readBoundedJson(response, controller.signal, () => emit(onEvent, { phase: 'first_body', elapsedMs: elapsed() }), bytes => emit(onEvent, { phase: 'body_end', elapsedMs: elapsed(), contentBytes: bytes }));
      invocationUsage = data.usage; stopReason = data.stopReason;
      refusal = Boolean(data.stopReason === 'guardrail_intervened' || data.stopReason === 'content_filtered');
      content = data.output?.message?.content?.filter(block => typeof block.text === 'string').map(block => block.text).join('');
      if (typeof content === 'string') {
        emit(onEvent, { phase: 'first_content', elapsedMs: elapsed(), contentBytes: Buffer.byteLength(content) });
        emit(onEvent, { phase: 'last_content', elapsedMs: elapsed(), contentBytes: Buffer.byteLength(content) });
      }
    }
    const usage = mapUsage(invocationUsage);
    if (!stream) emit(onEvent, { phase: 'usage', elapsedMs: elapsed(), usage: safeUsage(usage), costUsd: reportedCostUsd(usage) });
    if (reportedCostUsd(usage) === null) throw new BedrockError('BEDROCK_USAGE_UNKNOWN');
    if (reportedCostUsd(usage) > costLimitUsd) throw new BedrockError('BEDROCK_COST_LIMIT');
    checkDeadline();
    if (refusal) throw new BedrockError('BEDROCK_REFUSED');
    if (stopReason === 'max_tokens') throw new BedrockError('BEDROCK_OUTPUT_TRUNCATED');
    if (!['end_turn', 'stop_sequence'].includes(stopReason)) throw new BedrockError('BEDROCK_FINISH_REASON_INVALID');
    const wireOutput = validateJson(content, wire, 'BEDROCK_WIRE');
    const hydrated = typeof hydrateOutput === 'function' ? hydrateOutput(wireOutput) : wireOutput;
    checkDeadline();
    const output = validateJson(JSON.stringify(hydrated), schema, 'BEDROCK');
    checkDeadline();
    emit(onEvent, { phase: 'validated', elapsedMs: elapsed() });
    emit(onEvent, { phase: 'complete', elapsedMs: elapsed(), finishReason: stopReason, contentBytes: Buffer.byteLength(content) });
    return output;
  } catch (error) {
    if (error instanceof BedrockError) { emit(onEvent, { phase: 'error', elapsedMs: elapsed(), code: error.code }); throw error; }
    if (controller.signal.aborted) {
      const code = controller.signal.reason === 'CANCELLED' ? 'BEDROCK_CANCELLED' : 'BEDROCK_TIMEOUT';
      emit(onEvent, { phase: code === 'BEDROCK_CANCELLED' ? 'cancelled' : 'timeout', elapsedMs: elapsed(), code });
      throw new BedrockError(code, code === 'BEDROCK_CANCELLED' ? 499 : 504);
    }
    const code = /^BEDROCK_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'BEDROCK_NETWORK_ERROR';
    emit(onEvent, { phase: 'error', elapsedMs: elapsed(), code }); throw new BedrockError(code);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}

module.exports = { BASE_URL, MODEL, TIMEOUT_MS, MAX_OUTPUT_TOKENS, MAX_REPORTED_COST_USD, MAX_COST_CEILING_USD, reportedCostUsd, safeUsage, BedrockError, isConfigured, completeJson, makeWireSchema };
