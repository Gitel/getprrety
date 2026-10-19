'use strict';

const Ajv = require('ajv');
const credentials = require('../providerCredentials');
const { makeWireSchema } = require('../anthropic/wireSchema');

const MODEL = 'claude-opus-5-5';
const TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 8_000;
const MAX_REPORTED_COST_USD = 0.25;
// Keep the administrator's adjustable limit below this fixed per-request ceiling.
const MAX_COST_CEILING_USD = 0.50;
const RESERVED_COST_USD = 0.01;
const INPUT_ALLOWANCE_TOKENS = 128;
const INPUT_USD_PER_MILLION = 4;
const OUTPUT_USD_PER_MILLION = 20;
const MAX_IMAGE_BYTES = Math.floor(3.75 * 1024 * 1024);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function isSafeTokenCount(value) { return Number.isSafeInteger(value) && value >= 0; }

class AnthropicError extends Error {
  constructor(code, status = 502) {
    super(code === 'ANTHROPIC_NOT_CONFIGURED' ? 'Analysis service is unavailable' : 'Analysis provider failed');
    this.name = 'AnthropicError';
    this.code = code;
    this.status = status;
  }
}

function emit(onEvent, event) {
  if (typeof onEvent !== 'function') return;
  try { onEvent(event); } catch { /* Telemetry must never change provider behavior. */ }
}

async function isConfigured() {
  return Boolean(await credentials.getKey('anthropic'));
}

function normalizeUsage(usage) {
  if (!isSafeTokenCount(usage?.input_tokens) || !isSafeTokenCount(usage?.output_tokens)) return null;
  // We do not price cached tokens yet, so reject non-zero cache usage instead of under-reporting.
  for (const key of ['cache_read_input_tokens', 'cache_creation_input_tokens']) {
    const value = usage[key];
    if (value != null && (!isSafeTokenCount(value) || value !== 0)) return null;
  }
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens || 0,
    cacheWriteInputTokens: usage.cache_creation_input_tokens || 0,
  };
}

function reportedCostUsd(usage) {
  let normalized = usage?.inputTokens === undefined ? normalizeUsage(usage) : usage;
  // Evaluation diagnostics may pass the same provider-neutral telemetry shape as production logs.
  if (usage?.inputTokens === undefined && usage?.prompt_tokens !== undefined) {
    if ((usage.prompt_tokens_details?.cached_tokens ?? 0) !== 0) return null;
    normalized = { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
  }
  if (!normalized || !isSafeTokenCount(normalized.inputTokens) || !isSafeTokenCount(normalized.outputTokens)
    || (normalized.cacheReadInputTokens ?? 0) !== 0 || (normalized.cacheWriteInputTokens ?? 0) !== 0) return null;
  return (normalized.inputTokens * INPUT_USD_PER_MILLION + normalized.outputTokens * OUTPUT_USD_PER_MILLION) / 1_000_000;
}

function safeUsage(usage) {
  const normalized = normalizeUsage(usage);
  if (!normalized) return null;
  return {
    prompt_tokens: normalized.inputTokens,
    completion_tokens: normalized.outputTokens,
    prompt_tokens_details: { cached_tokens: 0 },
  };
}

function throwIfAborted(signal) {
  if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
}

function createDeadline(timeoutMs, signal) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const expiresAt = startedAt + timeoutMs;
  const timer = setTimeout(() => controller.abort('TIMEOUT'), timeoutMs);
  const abortFromCaller = () => controller.abort(signal.reason || 'CANCELLED');
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  return {
    controller,
    elapsed: () => Date.now() - startedAt,
    check() {
      throwIfAborted(controller.signal);
      if (Date.now() >= expiresAt) {
        controller.abort('TIMEOUT');
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
    },
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

function mapError(error, signal) {
  if (error instanceof AnthropicError) return error;
  if (signal?.aborted) {
    const cancelled = signal.reason === 'CANCELLED';
    return new AnthropicError(cancelled ? 'ANTHROPIC_CANCELLED' : 'ANTHROPIC_TIMEOUT', cancelled ? 499 : 504);
  }
  if (error?.status && Number.isInteger(error.status)) return new AnthropicError(`ANTHROPIC_HTTP_${error.status}`);
  if (error?.name === 'TimeoutError' || /timeout/i.test(error?.name || '')) return new AnthropicError('ANTHROPIC_TIMEOUT', 504);
  return new AnthropicError('ANTHROPIC_NETWORK_ERROR');
}

function formatContent(messages) {
  if (!Array.isArray(messages)) throw new AnthropicError('ANTHROPIC_INPUT_INVALID');
  return messages.map(message => {
    if (!message || !['user', 'assistant'].includes(message.role)) throw new AnthropicError('ANTHROPIC_INPUT_INVALID');
    if (typeof message.content === 'string') return { role: message.role, content: message.content };
    if (!Array.isArray(message.content)) throw new AnthropicError('ANTHROPIC_INPUT_INVALID');
    return {
      role: message.role,
      content: message.content.map(part => {
        if (part?.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text };
        if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
          const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.image_url.url);
          if (!match || match[2].length % 4 !== 0) throw new AnthropicError('ANTHROPIC_IMAGE_INVALID');
          const bytes = Buffer.from(match[2], 'base64');
          if (bytes.toString('base64') !== match[2]) throw new AnthropicError('ANTHROPIC_IMAGE_INVALID');
          if (bytes.length > MAX_IMAGE_BYTES) throw new AnthropicError('ANTHROPIC_IMAGE_TOO_LARGE');
          return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
        }
        throw new AnthropicError('ANTHROPIC_INPUT_INVALID');
      }),
    };
  });
}

function buildRequest({ system, messages, schema, schemaName = 'skin_analysis', wireSchema, maxTokens }) {
  if (!schema || typeof system !== 'string') throw new AnthropicError('ANTHROPIC_INPUT_INVALID');
  const wire = wireSchema || makeWireSchema(schema);
  return {
    model: MODEL,
    messages: formatContent(messages),
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    output_config: { format: { type: 'json_schema', schema: wire } },
  };
}

function validateJson(content, schema, codePrefix) {
  if (typeof content !== 'string' || !content.trim()) throw new AnthropicError('ANTHROPIC_INVALID_RESPONSE');
  let output;
  try { output = JSON.parse(content); } catch { throw new AnthropicError('ANTHROPIC_INVALID_JSON'); }
  const validator = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
  if (!validator(output)) throw new AnthropicError(`${codePrefix}_SCHEMA_INVALID`);
  return output;
}

function requestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function getSdkClient(apiKey, timeoutMs, fetchImpl) {
  // Lazy loading keeps unit tests that inject an SDK client independent of installed packages.
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

function countRequest({ system, messages, schema, schemaName = 'skin_analysis', wireSchema }) {
  const base = buildRequest({ system, messages, schema, schemaName, wireSchema, maxTokens: 1 });
  delete base.max_tokens;
  return base;
}

async function countTokens({
  system, messages, schema, schemaName = 'skin_analysis', token,
  timeoutMs = TIMEOUT_MS, signal, wireSchema, sdkClient, fetchImpl,
}) {
  const managedKey = token === undefined;
  const deadline = createDeadline(timeoutMs, signal);
  try {
    if (managedKey) token = await credentials.getKey('anthropic');
    if (!token) throw new AnthropicError('ANTHROPIC_NOT_CONFIGURED', 503);
    deadline.check();
    const client = sdkClient || getSdkClient(token, timeoutMs, fetchImpl);
    const result = await client.messages.countTokens(countRequest({ system, messages, schema, schemaName, wireSchema }), { signal: deadline.controller.signal });
    deadline.check();
    if (!isSafeTokenCount(result?.input_tokens) || result.input_tokens < 1) throw new AnthropicError('ANTHROPIC_COUNT_UNKNOWN');
    return { inputTokens: result.input_tokens };
  } catch (error) {
    if (managedKey && [401, 403].includes(error?.status)) {
      void credentials.recordHealth('anthropic', token, credentials.classifyFailure(error.status));
    }
    throw mapError(error, deadline.controller.signal);
  } finally {
    deadline.cleanup();
  }
}

function estimateOutputLimit(inputTokens, maxOutputTokens, maxCostUsd) {
  const requestedMax = Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : MAX_OUTPUT_TOKENS;
  const boundedMax = Math.min(MAX_OUTPUT_TOKENS, requestedMax);
  const requestedCost = Number.isFinite(maxCostUsd) && maxCostUsd > 0 ? maxCostUsd : MAX_REPORTED_COST_USD;
  const costLimitUsd = Math.min(MAX_COST_CEILING_USD, requestedCost);
  const estimatedInput = inputTokens + INPUT_ALLOWANCE_TOKENS;
  const outputTokenLimit = Math.min(boundedMax, Math.floor((costLimitUsd - RESERVED_COST_USD - estimatedInput * INPUT_USD_PER_MILLION / 1_000_000) * 1_000_000 / OUTPUT_USD_PER_MILLION));
  if (outputTokenLimit < 1) throw new AnthropicError('ANTHROPIC_COST_LIMIT');
  return {
    outputTokenLimit,
    costLimitUsd,
    estimatedCostUsd: (estimatedInput * INPUT_USD_PER_MILLION + outputTokenLimit * OUTPUT_USD_PER_MILLION) / 1_000_000 + RESERVED_COST_USD,
  };
}

function textFromMessage(message) {
  if (!Array.isArray(message?.content)) return '';
  return message.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
}

// Count first to reserve a bounded output allowance; SDK streaming bounds the body regardless of the caller's UI transport mode.
async function completeJson({
  system, messages, schema, schemaName = 'skin_analysis', maxOutputTokens = MAX_OUTPUT_TOKENS,
  maxCostUsd = MAX_REPORTED_COST_USD, token, fetchImpl, timeoutMs = TIMEOUT_MS,
  signal, onEvent, wireSchema, hydrateOutput, sdkClient,
}) {
  const managedKey = token === undefined;
  const deadline = createDeadline(timeoutMs, signal);
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  emit(onEvent, { phase: 'request_start', elapsedMs: 0 });
  try {
    if (managedKey) token = await credentials.getKey('anthropic');
    if (!token) throw new AnthropicError('ANTHROPIC_NOT_CONFIGURED', 503);
    const client = sdkClient || getSdkClient(token, timeoutMs, fetchImpl);
    deadline.check();
    const fields = countRequest({ system, messages, schema, schemaName, wireSchema });
    const countResult = await client.messages.countTokens(fields, { signal: deadline.controller.signal });
    emit(onEvent, { phase: 'headers', elapsedMs: elapsed(), status: 200 });
    emit(onEvent, { phase: 'first_body', elapsedMs: elapsed() });
    emit(onEvent, { phase: 'body_end', elapsedMs: elapsed() });
    deadline.check();
    if (!isSafeTokenCount(countResult?.input_tokens) || countResult.input_tokens < 1) throw new AnthropicError('ANTHROPIC_COUNT_UNKNOWN');

    const cap = estimateOutputLimit(countResult.input_tokens, maxOutputTokens, maxCostUsd);
    emit(onEvent, {
      phase: 'counted', elapsedMs: elapsed(), inputTokens: countResult.input_tokens,
      outputTokenLimit: cap.outputTokenLimit, estimatedCostUsd: cap.estimatedCostUsd,
    });

    const request = buildRequest({
      system, messages, schema, schemaName, wireSchema, maxTokens: cap.outputTokenLimit,
    });
    const providerStream = client.messages.stream(request, { signal: deadline.controller.signal });
    let firstContent = false;
    let contentBytes = 0;
    let responseTooLarge = false;
    let lastContentElapsed;
    // Observe only timing/size. Text stays in the SDK's bounded message accumulation, never telemetry.
    providerStream.on('streamEvent', event => {
      const initialText = event?.type === 'content_block_start' && event.content_block?.type === 'text' ? event.content_block.text : '';
      const deltaText = event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' ? event.delta.text : '';
      const text = `${initialText || ''}${deltaText || ''}`;
      if (!text) return;
      contentBytes += Buffer.byteLength(text, 'utf8');
      if (contentBytes > MAX_RESPONSE_BYTES) {
        responseTooLarge = true;
        providerStream.controller?.abort();
        return;
      }
      lastContentElapsed = elapsed();
      if (!firstContent) {
        firstContent = true;
        emit(onEvent, { phase: 'first_content', elapsedMs: lastContentElapsed, contentBytes });
      }
    });

    const responseInfo = await providerStream.withResponse();
    const id = requestId(responseInfo.request_id || responseInfo.response?.headers?.get?.('request-id'));
    emit(onEvent, { phase: 'headers', elapsedMs: elapsed(), status: responseInfo.response?.status || 200, ...(id ? { providerRequestId: id } : {}) });
    deadline.check();
    let message;
    try { message = await providerStream.finalMessage(); } catch (error) {
      if (responseTooLarge) throw new AnthropicError('ANTHROPIC_RESPONSE_TOO_LARGE');
      throw error;
    }
    if (responseTooLarge) throw new AnthropicError('ANTHROPIC_RESPONSE_TOO_LARGE');
    deadline.check();
    const text = textFromMessage(message);
    const actualBytes = Buffer.byteLength(text, 'utf8');
    if (actualBytes > MAX_RESPONSE_BYTES || contentBytes > MAX_RESPONSE_BYTES) throw new AnthropicError('ANTHROPIC_RESPONSE_TOO_LARGE');
    if (actualBytes !== contentBytes) throw new AnthropicError('ANTHROPIC_STREAM_INVALID');
    if (firstContent) emit(onEvent, { phase: 'last_content', elapsedMs: lastContentElapsed, contentBytes: actualBytes });
    emit(onEvent, { phase: 'body_end', elapsedMs: elapsed(), contentBytes: actualBytes });

    const usage = normalizeUsage(message?.usage);
    const safe = safeUsage(message?.usage);
    const costUsd = reportedCostUsd(usage);
    emit(onEvent, { phase: 'usage', elapsedMs: elapsed(), ...(safe ? { usage: safe } : {}), ...(costUsd !== null ? { costUsd } : {}) });
    if (!usage || costUsd === null) throw new AnthropicError('ANTHROPIC_USAGE_UNKNOWN');
    if (costUsd > cap.costLimitUsd) throw new AnthropicError('ANTHROPIC_COST_LIMIT');
    if (message.stop_reason === 'refusal') throw new AnthropicError('ANTHROPIC_REFUSED');
    if (message.stop_reason === 'max_tokens') throw new AnthropicError('ANTHROPIC_OUTPUT_TRUNCATED');
    if (!['end_turn', 'stop_sequence'].includes(message.stop_reason)) throw new AnthropicError('ANTHROPIC_FINISH_REASON_INVALID');

    const wire = wireSchema || makeWireSchema(schema);
    const wireOutput = validateJson(text, wire, 'ANTHROPIC_WIRE');
    deadline.check();
    const hydrated = typeof hydrateOutput === 'function' ? hydrateOutput(wireOutput) : wireOutput;
    const result = validateJson(JSON.stringify(hydrated), schema, 'ANTHROPIC');
    deadline.check();
    emit(onEvent, { phase: 'validated', elapsedMs: elapsed() });
    emit(onEvent, { phase: 'complete', elapsedMs: elapsed(), finishReason: message.stop_reason, contentBytes: actualBytes });
    // Return only complete, validated JSON; model deltas are never passed to the caller.
    return result;
  } catch (error) {
    if (managedKey && [401, 403].includes(error?.status)) {
      void credentials.recordHealth('anthropic', token, credentials.classifyFailure(error.status));
    }
    const mapped = mapError(error, deadline.controller.signal);
    emit(onEvent, {
      phase: mapped.code === 'ANTHROPIC_TIMEOUT' ? 'timeout' : mapped.code === 'ANTHROPIC_CANCELLED' ? 'cancelled' : 'error',
      elapsedMs: elapsed(), code: mapped.code,
    });
    throw mapped;
  } finally {
    deadline.cleanup();
  }
}

module.exports = {
  MODEL, TIMEOUT_MS, MAX_OUTPUT_TOKENS, MAX_REPORTED_COST_USD, MAX_COST_CEILING_USD,
  INPUT_USD_PER_MILLION, OUTPUT_USD_PER_MILLION,
  AnthropicError, isConfigured, safeUsage, reportedCostUsd, countTokens, completeJson,
};
