const Ajv = require('ajv');
const { MAX_SSE_CONTENT_BYTES, readSseEvents } = require('./sse');

const BASE_URL = 'https://bedrock-mantle.us-west-2.api.aws/openai/v1';
const MODEL = 'xai.grok-4.6';
const TIMEOUT_MS = 90_000;
const MAX_OUTPUT_TOKENS = 8_000;
const MAX_REPORTED_COST_USD = 0.25;

function reportedCostUsd(usage) {
  const prompt = usage?.prompt_tokens;
  const completion = usage?.completion_tokens;
  const cachedValue = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  if (![prompt, completion, cachedValue].every(value => Number.isSafeInteger(value) && value >= 0) || cachedValue > prompt) return null;
  return ((prompt - cachedValue) * 2.2 + cachedValue * 0.55 + completion * 6.6) / 1_000_000;
}

function safeUsage(usage) {
  if (reportedCostUsd(usage) === null) return null;
  const result = {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    prompt_tokens_details: { cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0 },
  };
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  if (Number.isSafeInteger(reasoning) && reasoning >= 0) result.completion_tokens_details = { reasoning_tokens: reasoning };
  return result;
}

function isConfigured() {
  return Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK);
}

class BedrockError extends Error {
  constructor(code, status = 502) {
    super(code === 'BEDROCK_NOT_CONFIGURED' ? 'Analysis service is unavailable' : 'Analysis provider failed');
    this.name = 'BedrockError';
    this.code = code;
    this.status = status;
  }
}

function emit(onEvent, event) {
  if (typeof onEvent !== 'function') return;
  try { onEvent(event); } catch { /* Telemetry callbacks must never change request behavior. */ }
}

function providerRequestId(response) {
  const value = response.headers?.get?.('x-request-id') || response.headers?.get?.('request-id');
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function validateFinish(finishReason, refusal) {
  if (refusal) throw new BedrockError('BEDROCK_REFUSED');
  if (finishReason === 'length') throw new BedrockError('BEDROCK_OUTPUT_TRUNCATED');
  if (!['stop', 'completed'].includes(finishReason)) throw new BedrockError('BEDROCK_FINISH_REASON_INVALID');
}

function validateContent(content, schema) {
  if (typeof content !== 'string') throw new BedrockError('BEDROCK_INVALID_RESPONSE');
  let output;
  try { output = JSON.parse(content); } catch { throw new BedrockError('BEDROCK_INVALID_JSON'); }
  // Nullable union types are intentional in this JSON schema; keep all other Ajv strict checks on.
  const validator = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
  if (!validator(output)) throw new BedrockError('BEDROCK_SCHEMA_INVALID');
  return output;
}

function throwIfAborted(signal) {
  if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
}

async function readBoundedJson(response, signal, onFirstByte, onBodyEnd) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  let firstByteSeen = false;
  try {
    while (true) {
      throwIfAborted(signal);
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SSE_CONTENT_BYTES) throw new BedrockError('BEDROCK_RESPONSE_TOO_LARGE');
      if (!firstByteSeen && value.byteLength) {
        firstByteSeen = true;
        onFirstByte?.();
      }
      try { text += decoder.decode(value, { stream: true }); } catch { throw new BedrockError('BEDROCK_INVALID_RESPONSE'); }
    }
    try { text += decoder.decode(); } catch { throw new BedrockError('BEDROCK_INVALID_RESPONSE'); }
    onBodyEnd?.(bytes);
    try { return JSON.parse(text); } catch { throw new BedrockError('BEDROCK_INVALID_RESPONSE'); }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock?.();
  }
}

// Keep provider details fixed and return only schema-validated JSON; stream mode never exposes partial model text.
async function completeJson({ system, messages, schema, schemaName = 'skin_analysis', maxOutputTokens = MAX_OUTPUT_TOKENS, token = process.env.AWS_BEARER_TOKEN_BEDROCK, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, signal, stream = false, onEvent }) {
  if (!token) throw new BedrockError('BEDROCK_NOT_CONFIGURED', 503);
  const controller = new AbortController();
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const timer = setTimeout(() => controller.abort('TIMEOUT'), timeoutMs);
  const onAbort = () => controller.abort(signal.reason || 'CANCELLED');
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  let contentBytes = 0;
  let usageSeen = false;
  let responseUsage;
  const reportUsage = usage => {
    const sanitized = safeUsage(usage);
    if (!sanitized) return;
    usageSeen = true;
    responseUsage = usage;
    emit(onEvent, { phase: 'usage', elapsedMs: elapsed(), usage: sanitized, costUsd: reportedCostUsd(usage) });
  };
  emit(onEvent, { phase: 'request_start', elapsedMs: 0 });
  try {
    const requestBody = {
      model: MODEL,
      messages: [{ role: 'system', content: system }, ...messages],
      reasoning_effort: 'low',
      max_completion_tokens: maxOutputTokens,
      response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
    };
    if (stream) {
      requestBody.stream = true;
      requestBody.stream_options = { include_usage: true };
    }
    throwIfAborted(controller.signal);
    const response = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const requestId = providerRequestId(response);
    emit(onEvent, { phase: 'headers', elapsedMs: elapsed(), ...(response.status ? { status: response.status } : {}), ...(requestId ? { providerRequestId: requestId } : {}) });
    throwIfAborted(controller.signal);
    if (!response.ok) {
      response.body?.cancel?.().catch?.(() => {});
      throw new BedrockError(`BEDROCK_HTTP_${response.status}`);
    }

    let content;
    let finishReason;
    let refusal;
    let data;
    if (stream) {
      let firstContent = false;
      let bodyEndSeen = false;
      let lastContentElapsed;
      try {
        await readSseEvents(response.body, event => {
          if (event.usage) reportUsage(event.usage);
          const choice = event.choices?.[0];
          if (!choice) return;
          if (choice.delta?.refusal) refusal = true;
          if (typeof choice.delta?.content === 'string' && choice.delta.content) {
            const delta = choice.delta.content;
            contentBytes += Buffer.byteLength(delta, 'utf8');
            if (contentBytes > MAX_SSE_CONTENT_BYTES) throw new BedrockError('BEDROCK_STREAM_TOO_LARGE');
            content = (content || '') + delta;
            lastContentElapsed = elapsed();
            if (!firstContent) {
              firstContent = true;
              emit(onEvent, { phase: 'first_content', elapsedMs: elapsed(), contentBytes });
            }
          }
          if (choice.finish_reason != null) finishReason = choice.finish_reason;
        }, controller.signal,
        () => emit(onEvent, { phase: 'first_body', elapsedMs: elapsed() }),
        bytes => {
          bodyEndSeen = true;
          if (contentBytes) emit(onEvent, { phase: 'last_content', elapsedMs: lastContentElapsed, contentBytes });
          emit(onEvent, { phase: 'body_end', elapsedMs: elapsed(), contentBytes: bytes });
        });
      } finally {
        if (contentBytes && !bodyEndSeen) emit(onEvent, { phase: 'last_content', elapsedMs: lastContentElapsed, contentBytes });
      }
    } else {
      if (response.body && typeof response.body.getReader === 'function') {
        data = await readBoundedJson(
          response,
          controller.signal,
          () => emit(onEvent, { phase: 'first_body', elapsedMs: elapsed() }),
          bytes => emit(onEvent, { phase: 'body_end', elapsedMs: elapsed(), contentBytes: bytes })
        );
      } else if (typeof response.text === 'function') {
        const text = await response.text();
        contentBytes = Buffer.byteLength(text, 'utf8');
        if (contentBytes > MAX_SSE_CONTENT_BYTES) throw new BedrockError('BEDROCK_RESPONSE_TOO_LARGE');
        try { data = JSON.parse(text); } catch { throw new BedrockError('BEDROCK_INVALID_RESPONSE'); }
        emit(onEvent, { phase: 'body_end', elapsedMs: elapsed(), contentBytes });
      } else {
        data = await response.json();
        emit(onEvent, { phase: 'body_end', elapsedMs: elapsed() });
      }
      reportUsage(data?.usage);
      const choice = data?.choices?.[0];
      finishReason = choice?.finish_reason;
      refusal = choice?.message?.refusal;
      content = choice?.message?.content;
      if (typeof content === 'string') {
        contentBytes = Buffer.byteLength(content, 'utf8');
        emit(onEvent, { phase: 'first_content', elapsedMs: elapsed(), contentBytes });
        emit(onEvent, { phase: 'last_content', elapsedMs: elapsed(), contentBytes });
      }
    }

    if (!usageSeen) throw new BedrockError('BEDROCK_USAGE_UNKNOWN');
    throwIfAborted(controller.signal);
    if (reportedCostUsd(responseUsage) > MAX_REPORTED_COST_USD) throw new BedrockError('BEDROCK_COST_LIMIT');
    validateFinish(finishReason, refusal);
    const output = validateContent(content, schema);
    throwIfAborted(controller.signal);
    emit(onEvent, { phase: 'validated', elapsedMs: elapsed() });
    emit(onEvent, { phase: 'complete', elapsedMs: elapsed(), ...(finishReason ? { finishReason } : {}), contentBytes });
    return output;
  } catch (error) {
    if (error instanceof BedrockError) {
      emit(onEvent, { phase: 'error', elapsedMs: elapsed(), code: error.code });
      throw error;
    }
    if (controller.signal.aborted) {
      const code = controller.signal.reason === 'CANCELLED' ? 'BEDROCK_CANCELLED' : 'BEDROCK_TIMEOUT';
      emit(onEvent, { phase: code === 'BEDROCK_CANCELLED' ? 'cancelled' : 'timeout', elapsedMs: elapsed(), code });
      throw new BedrockError(code, code === 'BEDROCK_CANCELLED' ? 499 : 504);
    }
    const code = error?.message?.startsWith('BEDROCK_') ? error.message : 'BEDROCK_NETWORK_ERROR';
    emit(onEvent, { phase: 'error', elapsedMs: elapsed(), code });
    throw new BedrockError(code);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

module.exports = { BASE_URL, MODEL, TIMEOUT_MS, MAX_OUTPUT_TOKENS, MAX_REPORTED_COST_USD, reportedCostUsd, BedrockError, isConfigured, completeJson };
