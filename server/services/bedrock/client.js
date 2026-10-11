const Ajv = require('ajv');

const BASE_URL = 'https://bedrock-mantle.us-west-2.api.aws/openai/v1';
const MODEL = 'xai.grok-4.6';
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 8_000;
const MAX_REPORTED_COST_USD = 0.25;

function reportedCostUsd(usage) {
  const prompt = usage?.prompt_tokens;
  const completion = usage?.completion_tokens;
  const cachedValue = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  if (![prompt, completion, cachedValue].every(value => Number.isSafeInteger(value) && value >= 0) || cachedValue > prompt) return null;
  const cached = cachedValue;
  return ((prompt - cached) * 2.2 + cached * 0.55 + completion * 6.6) / 1_000_000;
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

// Keep the provider details fixed on the server so callers cannot select a different model or endpoint.
async function completeJson({ system, messages, schema, schemaName = 'skin_analysis', maxOutputTokens = MAX_OUTPUT_TOKENS, token = process.env.AWS_BEARER_TOKEN_BEDROCK, fetchImpl = fetch, timeoutMs = TIMEOUT_MS }) {
  if (!token) throw new BedrockError('BEDROCK_NOT_CONFIGURED', 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: system }, ...messages],
        reasoning_effort: 'low',
        max_completion_tokens: maxOutputTokens,
        response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new BedrockError(`BEDROCK_HTTP_${response.status}`);
    const data = await response.json();
    // The provider has already charged for a response at this point; reject unverifiable or over-cap usage before returning it.
    const cost = reportedCostUsd(data?.usage);
    if (cost === null) throw new BedrockError('BEDROCK_USAGE_UNKNOWN');
    if (cost > MAX_REPORTED_COST_USD) throw new BedrockError('BEDROCK_COST_LIMIT');
    const choice = data?.choices?.[0];
    const message = choice?.message;
    if (message?.refusal) throw new BedrockError('BEDROCK_REFUSED');
    if (choice?.finish_reason === 'length') throw new BedrockError('BEDROCK_OUTPUT_TRUNCATED');
    if (!['stop', 'completed'].includes(choice?.finish_reason)) {
      throw new BedrockError('BEDROCK_FINISH_REASON_INVALID');
    }
    const content = message?.content;
    if (typeof content !== 'string') throw new BedrockError('BEDROCK_INVALID_RESPONSE');
    let output;
    try { output = JSON.parse(content); } catch { throw new BedrockError('BEDROCK_INVALID_JSON'); }
    // Nullable union types are intentional in this JSON schema; keep all other Ajv strict checks on.
    const validator = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
    if (!validator(output)) throw new BedrockError('BEDROCK_SCHEMA_INVALID');
    return output;
  } catch (error) {
    if (error instanceof BedrockError) throw error;
    if (error?.name === 'AbortError') throw new BedrockError('BEDROCK_TIMEOUT');
    throw new BedrockError('BEDROCK_NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { BASE_URL, MODEL, TIMEOUT_MS, MAX_OUTPUT_TOKENS, MAX_REPORTED_COST_USD, reportedCostUsd, BedrockError, isConfigured, completeJson };
