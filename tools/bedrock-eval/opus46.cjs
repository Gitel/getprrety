#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Ajv = require('ajv');
const { execFileSync } = require('node:child_process');
const { outputSchema, validateOutput, eligibleProducts: selectEligibleProducts } = require('../../server/services/bedrock/analysisContract');
const { loadSeedCatalogue, loadSnapshotCatalogue } = require('../../server/services/bedrock/catalogue');
const { prepareSkinRequest } = require('../../server/services/bedrock/skinRequest');
const { COMPACT_CONTRACT_VERSION } = require('../../server/services/bedrock/compact');
const { readCase } = require('./runner.cjs');
const { parseArgs, isInside, getToken } = require('./run.cjs');
const { writeAtomicCheckpoint } = require('./investigate.cjs');

const ROOT = path.resolve(__dirname, '../..');
const MODEL = 'us.anthropic.claude-opus-4-6-v1';
const COUNT_MODEL = 'anthropic.claude-opus-4-6-v1';
const BASE_URL = 'https://bedrock-runtime.us-east-1.amazonaws.com';
const MANTLE_COUNT_URL = 'https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages/count_tokens';
const TIMEOUT_MS = 90_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 8_000;
const COST_CEILING_USD = 0.25;
const RESERVED_COST_USD = 0.01;
// The prior free comparison found a 17-token count/use delta; keep a larger allowance and label the cap as estimated.
const INPUT_COUNT_ALLOWANCE_TOKENS = 128;
const INPUT_USD_PER_MILLION = 5.5;
const OUTPUT_USD_PER_MILLION = 27.5;
const DEFAULT_CASE_ID = 'case-568f7d2ab3';
const DEFAULT_LANGUAGE = 'en';
const MAX_COUNTABLE_IMAGE_BYTES = Math.floor(3.75 * 1024 * 1024);

// Bedrock structured output accepts only a subset; local validation keeps using the untouched contract.
function makeWireSchema(schema) {
  if (Array.isArray(schema)) return schema.map(makeWireSchema);
  if (!schema || typeof schema !== 'object') return schema;
  // Encode nullable objects as one union node; Bedrock rejected the original grammar as too large.
  if (Object.keys(schema).length === 1 && Array.isArray(schema.anyOf) && schema.anyOf.length === 2) {
    const nullBranch = schema.anyOf.find(branch => branch?.type === 'null');
    const objectBranch = schema.anyOf.find(branch => branch?.type === 'object');
    if (nullBranch && Object.keys(nullBranch).length === 1 && objectBranch) {
      const wire = makeWireSchema(objectBranch);
      return { ...wire, type: ['object', 'null'] };
    }
  }
  const wire = {};
  for (const [key, value] of Object.entries(schema)) {
    if (['maxItems', 'minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength'].includes(key)) continue;
    if (key === 'minItems' && value > 1) continue;
    wire[key] = makeWireSchema(value);
  }
  return wire;
}

// Preserve the canonical prompt's image blocks so provider calls never silently lose photo evidence.
function toConverse(built, schema = makeWireSchema(outputSchema)) {
  const messages = built.messages.map(message => ({
    role: message.role,
    content: typeof message.content === 'string' ? [{ text: message.content }] : message.content.map(part => {
      if (part?.type === 'text' && typeof part.text === 'string') return { text: part.text };
      if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
        const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.image_url.url);
        if (!match || match[2].length % 4 !== 0) throw new Error('probe image block is invalid');
        const bytes = Buffer.from(match[2], 'base64');
        if (bytes.length > MAX_COUNTABLE_IMAGE_BYTES || bytes.toString('base64') !== match[2]) throw new Error('probe image block exceeds Bedrock limits');
        // The fetch-based REST client needs the service's JSON base64 representation, not Buffer's JSON object.
        return { image: { format: match[1] === 'image/jpeg' ? 'jpeg' : 'png', source: { bytes: match[2] } } };
      }
      throw new Error('probe input contains an unsupported content block');
    }),
  }));
  const outputConfig = { textFormat: { type: 'json_schema', structure: { jsonSchema: { schema: JSON.stringify(schema), name: 'skin_analysis' } } } };
  return { system: [{ text: built.system }], messages, outputConfig };
}

function promptFingerprint(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function maxOutputTokens(inputTokens) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens <= 0) return 0;
  // Include the count allowance and reserved output dollars when deriving each call's completion cap.
  const inputCost = (inputTokens + INPUT_COUNT_ALLOWANCE_TOKENS) * INPUT_USD_PER_MILLION / 1_000_000;
  return Math.max(0, Math.min(MAX_OUTPUT_TOKENS, Math.floor((COST_CEILING_USD - RESERVED_COST_USD - inputCost) * 1_000_000 / OUTPUT_USD_PER_MILLION)));
}

function reportedCostUsd(usage) {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  const cacheRead = usage?.cacheReadInputTokens ?? 0;
  const cacheWrite = usage?.cacheWriteInputTokens ?? 0;
  if (![input, output, cacheRead, cacheWrite].every(value => Number.isSafeInteger(value) && value >= 0)
    || cacheRead + cacheWrite > input || cacheRead || cacheWrite) return null;
  return (input * INPUT_USD_PER_MILLION + output * OUTPUT_USD_PER_MILLION) / 1_000_000;
}

function errorCategory(status) {
  if (status === 401 || status === 403) return 'access';
  if (status === 404) return 'model';
  if (status === 400) return 'request';
  if (status === 429) return 'throttled';
  return status >= 500 ? 'service' : 'request';
}

function safeRequestId(response) {
  const id = response.headers?.get?.('x-amzn-requestid') || response.headers?.get?.('x-amzn-request-id');
  return typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? id : undefined;
}

async function readJsonBoundedTimed(response, onFirstByte) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
    if (text.length) onFirstByte();
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let firstByte = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
      if (!firstByte && value.byteLength) { firstByte = true; onFirstByte(); }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock?.();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

// Interpret only fixed error categories; raw provider messages can contain private identifiers.
function safeProviderFailure(response, data) {
  const allowedTypes = ['AccessDeniedException', 'ValidationException', 'ResourceNotFoundException', 'ThrottlingException', 'ServiceUnavailableException', 'InternalServerException', 'UnrecognizedClientException', 'ExpiredTokenException', 'InvalidSignatureException'];
  const type = String(response.headers?.get?.('x-amzn-errortype') || data?.__type || data?.code || data?.type || '').split(/[:#]/).at(-1);
  const message = [data?.message, data?.Message, data?.error?.message].find(value => typeof value === 'string') || '';
  let reason = response.status === 400 ? 'request_validation' : [401, 403].includes(response.status) ? 'access_denied' : 'unknown';
  if (/token.{0,40}expired|expired.{0,40}token/i.test(message)) reason = 'expired_token';
  else if (/invalid.{0,30}(token|api.key)|security token.{0,30}invalid/i.test(message)) reason = 'invalid_token';
  else if (/not available for (this|your) account/i.test(message)) reason = 'model_unavailable_for_account';
  else if (/aws-marketplace|marketplace.{0,30}subscri/i.test(message)) reason = 'marketplace_access';
  else if (/use.case.{0,40}(submit|form)|use.case.{0,40}details/i.test(message)) reason = 'anthropic_use_case';
  else if (/not authorized|explicit deny|insufficient permissions/i.test(message)) reason = 'permission_denied';
  else if (/grammar.{0,80}(too large|exceed|maximum|limit)|(?:too large|exceed).{0,80}grammar/i.test(message)) reason = 'compiled_grammar_too_large';
  else if (/schema.{0,40}(unsupported|invalid)|unsupported.{0,40}schema/i.test(message)) reason = 'schema_validation';
  return { category: errorCategory(response.status), status: response.status, reason,
    ...(allowedTypes.includes(type) ? { exceptionType: type } : {}) };
}

async function requestJson({ operation, modelId = MODEL, body, token, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, onPhase = () => {} }) {
  if (!token) throw new Error('missing_token');
  const controller = new AbortController();
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  onPhase({ phase: 'request_start', elapsedMs: 0 });
  try {
    const response = await fetchImpl(`${BASE_URL}/model/${modelId}/${operation}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    const requestId = safeRequestId(response);
    onPhase({ phase: 'headers', elapsedMs: elapsed(), status: response.status, ...(requestId ? { providerRequestId: requestId } : {}) });
    if (!response.ok) {
      let data;
      try { data = await readJsonBoundedTimed(response, () => onPhase({ phase: 'first_body', elapsedMs: elapsed() })); } catch { /* Retain the HTTP status when an error body is not JSON. */ }
      throw Object.assign(new Error('provider_error'), safeProviderFailure(response, data));
    }
    const data = await readJsonBoundedTimed(response, () => onPhase({ phase: 'first_body', elapsedMs: elapsed() }));
    onPhase({ phase: 'body_end', elapsedMs: elapsed() });
    return { data, requestId, elapsedMs: elapsed() };
  } catch (error) {
    if (controller.signal.aborted) {
      onPhase({ phase: 'timeout', elapsedMs: elapsed() });
      throw Object.assign(new Error('request_timeout'), { category: 'timeout' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function countTokens({ converse, additionalModelRequestFields, token, fetchImpl = fetch, onPhase = () => {}, api = 'bedrock-runtime' }) {
  if (api === 'bedrock-runtime') {
    const result = await requestJson({ operation: 'count-tokens', modelId: COUNT_MODEL,
      body: { input: { converse: { system: converse.system, messages: converse.messages,
        ...(additionalModelRequestFields ? { additionalModelRequestFields } : {}) } } }, token, fetchImpl, onPhase });
    const inputTokens = result.data?.inputTokens;
    if (!Number.isSafeInteger(inputTokens) || inputTokens <= 0) throw Object.assign(new Error('count_unavailable'), { category: 'count' });
    return { inputTokens, elapsedMs: result.elapsedMs, providerRequestId: result.requestId };
  }
  if (api !== 'anthropic-mantle') throw new Error('count_api_invalid');
  // Mantle CountTokens is an explicit option because it uses a separate permission; runtime denial never triggers fallback.
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const elapsedMs = () => Date.now() - started;
  const body = {
    model: COUNT_MODEL,
    system: converse.system.map(block => block.text).join('\n'),
    messages: converse.messages.map(message => ({ role: message.role, content: message.content.map(block => block.text).join('\n') })),
  };
  onPhase({ phase: 'request_start', elapsedMs: 0 });
  let result;
  try {
    const response = await fetchImpl(MANTLE_COUNT_URL, { method: 'POST', headers: {
      'x-api-key': token, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json',
    }, body: JSON.stringify(body), signal: controller.signal });
    const requestId = safeRequestId(response);
    onPhase({ phase: 'headers', elapsedMs: elapsedMs(), status: response.status, ...(requestId ? { providerRequestId: requestId } : {}) });
    if (!response.ok) {
      let data;
      try { data = await readJsonBoundedTimed(response, () => onPhase({ phase: 'first_body', elapsedMs: elapsedMs() })); } catch { /* Keep only safe error metadata if the body is malformed. */ }
      throw Object.assign(new Error('provider_error'), safeProviderFailure(response, data));
    }
    const data = await readJsonBoundedTimed(response, () => onPhase({ phase: 'first_body', elapsedMs: elapsedMs() }));
    onPhase({ phase: 'body_end', elapsedMs: elapsedMs() });
    result = { data, requestId, elapsedMs: elapsedMs() };
  } catch (error) {
    if (controller.signal.aborted) {
      onPhase({ phase: 'timeout', elapsedMs: elapsedMs() });
      throw Object.assign(new Error('request_timeout'), { category: 'timeout' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const inputTokens = result.data?.input_tokens;
  if (!Number.isSafeInteger(inputTokens) || inputTokens <= 0) throw Object.assign(new Error('count_unavailable'), { category: 'count' });
  return { inputTokens, elapsedMs: result.elapsedMs, providerRequestId: result.requestId };
}

async function infer({ converse, token, fetchImpl, onPhase, maxTokens }) {
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > MAX_OUTPUT_TOKENS) throw new Error('output_budget_invalid');
  const requestStartedAt = performance.now();
  const result = await requestJson({ operation: 'converse', body: { ...converse, inferenceConfig: { maxTokens } }, token, fetchImpl, onPhase });
  const message = result.data?.output?.message;
  const text = message?.content?.filter(block => typeof block?.text === 'string').map(block => block.text).join('');
  const usage = result.data?.usage;
  const costUsd = reportedCostUsd(usage);
  if (typeof text !== 'string') return { output: null, parseError: 'invalid_response', usage: safeUsage(usage), costUsd, stopReason: result.data.stopReason, elapsedMs: result.elapsedMs, totalElapsedMs: performance.now() - requestStartedAt, providerRequestId: result.requestId };
  let output;
  try { output = JSON.parse(text); } catch { return { output: null, parseError: 'invalid_json', usage: safeUsage(usage), costUsd, stopReason: result.data.stopReason, elapsedMs: result.elapsedMs, totalElapsedMs: performance.now() - requestStartedAt, providerRequestId: result.requestId }; }
  return { output, usage: safeUsage(usage), costUsd, stopReason: result.data.stopReason, elapsedMs: result.elapsedMs, totalElapsedMs: performance.now() - requestStartedAt, providerRequestId: result.requestId };
}

function safeUsage(usage) {
  if (!usage || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens)
    || usage.inputTokens < 0 || usage.outputTokens < 0) return null;
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    cacheReadInputTokens: Number.isSafeInteger(usage.cacheReadInputTokens) ? usage.cacheReadInputTokens : 0,
    cacheWriteInputTokens: Number.isSafeInteger(usage.cacheWriteInputTokens) ? usage.cacheWriteInputTokens : 0 };
}

function validateAjvOutput(output) {
  return validateAjvSchema(output, outputSchema);
}

function validateAjvSchema(output, schema) {
  const validator = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
  return validator(output) ? [] : validator.errors.map(error => ({ keyword: error.keyword, instancePath: error.instancePath }));
}

// Recompute the budget from a matching count instead of trusting a stored output-token cap.
function verifyCountReport(report, promptSha256, expected = {}) {
  return report.mode === 'count' && report.status === 'counted' && report.promptSha256 === promptSha256
    && report.model === MODEL && report.countModel === COUNT_MODEL && report.region === 'us-east-1'
    && report.countApi === 'bedrock-runtime' && report.countMethod === 'bedrock-runtime-converse-native-schema-v1' && report.schemaAwareCount === true
    && (!expected.caseId || report.caseId === expected.caseId)
    && (!expected.language || report.language === expected.language)
    && (!Number.isSafeInteger(expected.imageCount) || report.imageCount === expected.imageCount)
    && Number.isSafeInteger(report.inputTokens) && report.inputTokens > 0
    && report.outputTokenLimit === maxOutputTokens(report.inputTokens) && report.outputTokenLimit > 0;
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const mode = options.mode;
  if (!['count', 'analysis'].includes(mode) || !options['input-dir'] || !options.output) throw new Error('required: --mode count|analysis --input-dir DIR --output FILE [--server-dir DIR] [--count-report FILE]');
  if (mode === 'analysis' && !options['count-report']) throw new Error('analysis mode requires --count-report from a successful count mode');
  const inputDirectory = path.resolve(options['input-dir']);
  const outputFile = path.resolve(options.output);
  if (isInside(ROOT, inputDirectory) || isInside(ROOT, outputFile)) throw new Error('input and output must be outside the application worktree');
  const caseId = options['case-id'] || DEFAULT_CASE_ID;
  const language = options.language || DEFAULT_LANGUAGE;
  if (!/^case-[a-z0-9-]{1,64}$/.test(caseId) || !['en', 'he'].includes(language)) throw new Error('case ID or language is invalid');
  const testCase = await readCase(path.join(inputDirectory, caseId));
  if (testCase.caseId !== caseId) throw new Error('case folder and case ID do not match');
  const catalogue = options['catalogue-file']
    ? loadSnapshotCatalogue(path.resolve(options['catalogue-file']))
    : loadSeedCatalogue();
  const eligibleCatalogue = selectEligibleProducts(catalogue, testCase.quiz);
  const prepared = prepareSkinRequest({ quiz: testCase.quiz, language, images: testCase.images, catalogue });
  const { wireSchema } = prepared;
  // This is the same production request used for counts and inference.
  const converse = toConverse(prepared, wireSchema);
  const countSchemaFields = { output_config: { format: { type: 'json_schema', schema: wireSchema } } };
  const countInput = { system: converse.system, messages: converse.messages, additionalModelRequestFields: countSchemaFields };
  const promptSha256 = promptFingerprint(countInput);
  const countApi = mode === 'count' ? (options['count-api'] || 'bedrock-runtime') : undefined;
  if (mode === 'count' && countApi !== 'bedrock-runtime') throw new Error('schema-aware count mode requires --count-api bedrock-runtime');
  const metadata = { generatedAt: new Date().toISOString(), mode, model: MODEL, countModel: COUNT_MODEL, region: 'us-east-1', routing: 'US cross-region', timeoutMs: TIMEOUT_MS, automaticRetries: 0,
    ...(mode === 'count' ? { countApi, countMethod: 'bedrock-runtime-converse-native-schema-v1', schemaAwareCount: true,
      inputCountAllowanceTokens: INPUT_COUNT_ALLOWANCE_TOKENS,
      costGate: 'estimate_not_guarantee_with_128_input_token_allowance_and_0.01_usd_output_reserve' } : {}),
    caseId, language, imageCount: testCase.images.length, stream: false, tier: 'default', promptSha256,
    compactContractVersion: COMPACT_CONTRACT_VERSION,
    productionPromptSha256: promptFingerprint({ system: prepared.system, messages: prepared.messages }), schemaSha256: promptFingerprint(outputSchema), wireSchemaSha256: promptFingerprint(wireSchema),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    pricing: { inputUsdPerMillion: INPUT_USD_PER_MILLION, outputUsdPerMillion: OUTPUT_USD_PER_MILLION, source: 'https://www-cdn.anthropic.com/files/4zrzovbb/website/3684c2faafb97418665782cea0001f439f74b1d2.pdf' } };
  const token = (deps.getToken || getToken)(options['server-dir']);
  const fetchImpl = deps.fetchImpl || fetch;
  const report = { ...metadata, phases: [], providerRequestId: null, status: 'in_flight', costUsd: null, costUnknown: mode === 'analysis' };
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const placeholder = await fs.open(outputFile, 'wx');
  await placeholder.close();
  // An interrupted paid call must leave a durable record of unknown cost before it starts.
  await writeAtomicCheckpoint(outputFile, report);
  const started = performance.now();
  const onPhase = phase => {
    report.phases.push(phase);
    if (phase.providerRequestId) report.providerRequestId = phase.providerRequestId;
  };
  try {
    if (mode === 'count') {
      // CountTokens gets actual prompt blocks and the provider-native schema constraint used for inference.
      const counted = await countTokens({ converse: { system: converse.system, messages: converse.messages },
        additionalModelRequestFields: countSchemaFields, token, fetchImpl, onPhase, api: countApi });
      const outputTokenLimit = maxOutputTokens(counted.inputTokens);
      if (!outputTokenLimit) throw Object.assign(new Error('budget_too_small'), { category: 'budget' });
      Object.assign(report, { inputTokens: counted.inputTokens, outputTokenLimit,
        estimatedInputCostUsd: counted.inputTokens * INPUT_USD_PER_MILLION / 1_000_000,
        bufferedInputCostUsd: (counted.inputTokens + INPUT_COUNT_ALLOWANCE_TOKENS) * INPUT_USD_PER_MILLION / 1_000_000,
        reservedCostUsd: RESERVED_COST_USD, status: 'counted', providerRequestId: counted.providerRequestId, elapsedMs: counted.elapsedMs });
    } else {
      const countReport = JSON.parse(await fs.readFile(path.resolve(options['count-report']), 'utf8'));
      if (!verifyCountReport(countReport, promptSha256, { caseId, language, imageCount: testCase.images.length })) throw Object.assign(new Error('count_report_invalid'), { category: 'budget' });
      const analysisStarted = performance.now();
      report.outputTokenLimit = countReport.outputTokenLimit;
      const inferred = await infer({ converse, token, fetchImpl, maxTokens: report.outputTokenLimit, onPhase });
      // Preserve reported usage even if parsing or local validation subsequently rejects the analysis.
      Object.assign(report, {
        usage: inferred.usage, costUsd: inferred.costUsd, costUnknown: inferred.costUsd === null,
        stopReason: ['end_turn', 'max_tokens', 'stop_sequence'].includes(inferred.stopReason) ? inferred.stopReason : 'other',
        elapsedMs: inferred.elapsedMs, providerRequestId: inferred.providerRequestId,
      });
      if (report.costUnknown || report.costUsd > COST_CEILING_USD) throw Object.assign(new Error('cost_invalid'), { category: 'cost' });
      if (inferred.parseError) throw Object.assign(new Error('invalid_response'), { category: 'response' });
      report.outputBytes = inferred.output === null ? 0 : Buffer.byteLength(JSON.stringify(inferred.output));
      const wireSchemaErrors = validateAjvSchema(inferred.output, wireSchema);
      report.wireSchemaErrorCount = wireSchemaErrors.length;
      let canonicalOutput = null;
      if (!wireSchemaErrors.length) {
        try {
          canonicalOutput = prepared.hydrateOutput(inferred.output);
        } catch {
          // Keep model-supplied product IDs and labels out of error details and saved reports.
          report.hydrationErrorCount = 1;
        }
      }
      const canonicalSchemaErrors = canonicalOutput ? validateAjvOutput(canonicalOutput) : [];
      report.canonicalSchemaErrorCount = canonicalSchemaErrors.length;
      report.schemaErrorCount = wireSchemaErrors.length + (report.hydrationErrorCount || 0) + canonicalSchemaErrors.length;
      const validationErrors = report.schemaErrorCount ? [] : validateOutput(canonicalOutput, { quiz: testCase.quiz, language, images: testCase.images }, catalogue).errors;
      report.semanticErrorCount = report.schemaErrorCount ? null : validationErrors.length;
      if (!report.schemaErrorCount) {
        // Summarize quality checks by fixed category names; generated text and product labels stay out of reports.
        report.semanticErrorCategories = summarizeSemanticErrors(validationErrors);
        report.qualityMetrics = summarizeQualityMetrics(canonicalOutput, testCase, catalogue);
      }
      const total = performance.now() - analysisStarted;
      onPhase({ phase: 'validation', elapsedMs: Math.round(total) });
      if (total > TIMEOUT_MS) throw Object.assign(new Error('request_timeout'), { category: 'timeout' });
      if (report.schemaErrorCount || report.semanticErrorCount || inferred.stopReason !== 'end_turn') throw Object.assign(new Error('analysis_invalid'), { category: 'validation' });
      report.status = 'valid';
    }
  } catch (error) {
    report.status = 'failed';
    report.failureCategory = ['access', 'model', 'schema', 'throttled', 'service', 'request', 'timeout', 'count', 'budget', 'cost', 'response', 'validation'].includes(error.category) ? error.category : 'request';
    if (Number.isInteger(error.status) && error.status >= 100 && error.status <= 599) report.httpStatus = error.status;
    if (error.reason) report.failureReason = error.reason;
    if (error.exceptionType) report.exceptionType = error.exceptionType;
  }
  report.totalMs = Math.round(performance.now() - started);
  report.phases.push({ phase: 'end', elapsedMs: report.totalMs });
  await writeAtomicCheckpoint(outputFile, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== 'counted' && report.status !== 'valid') process.exitCode = 1;
  return report;
}

function summarizeSemanticErrors(errors) {
  const counts = {};
  for (const error of errors) {
    const category = /catalogue|product.*id|product category|name does not match/i.test(error) ? 'catalogue_reference'
      : /routine|step number|step instruction/i.test(error) ? 'routine'
        : /safety|allerg|pregnan|irritant|contraindication/i.test(error) ? 'safety'
          : /language/i.test(error) ? 'language'
            : /shelf/i.test(error) ? 'shelf_evidence'
              : /event/i.test(error) ? 'event_context' : 'other';
    counts[category] = (counts[category] || 0) + 1;
  }
  return counts;
}

function summarizeQualityMetrics(output, testCase, catalogue) {
  const am = output?.era?.routine?.am || [];
  const pm = output?.era?.routine?.pm || [];
  const requiredAm = ['cleanse', 'moisturize', 'protect'];
  const requiredPm = ['cleanse', 'moisturize'];
  const referencedIds = [];
  for (const item of output?.era?.product_audit?.current_products_assessment || []) {
    if (item?.verdict === 'replace' && item.suggested_replacement_product_id) referencedIds.push(item.suggested_replacement_product_id);
  }
  if (output?.srProducts?.era_hero_product?.sr_product_id) referencedIds.push(output.srProducts.era_hero_product.sr_product_id);
  for (const period of ['am', 'pm']) for (const step of output?.srProducts?.[period] || []) if (step?.sr_product_id) referencedIds.push(step.sr_product_id);
  const shelfProducts = output?.shelfAnalysis?.identified_products || [];
  for (const product of shelfProducts) if (product?.sr_substitute_product_id) referencedIds.push(product.sr_substitute_product_id);
  const firstPurchase = output?.shelfAnalysis?.transition_plan?.first_sr_purchase_product_id;
  if (firstPurchase) referencedIds.push(firstPurchase);
  const eligible = new Set(selectEligibleProducts(catalogue, testCase.quiz).map(product => String(product._id)));
  return {
    amCoreStepsPresent: requiredAm.every(category => am.some(step => step?.category_id === category)),
    pmCoreStepsPresent: requiredPm.every(category => pm.some(step => step?.category_id === category)),
    amStartsCleanse: am[0]?.category_id === 'cleanse',
    amEndsProtect: am.length > 0 && am.at(-1)?.category_id === 'protect',
    pmStartsCleanse: pm[0]?.category_id === 'cleanse',
    catalogueReferencedIdCount: referencedIds.length,
    catalogueValidIdCount: referencedIds.filter(id => eligible.has(String(id))).length,
    safetyFlagCount: Array.isArray(output?.era?.safety_flags) ? output.era.safety_flags.length : 0,
    shelfProductCount: shelfProducts.length,
  };
}

if (require.main === module) main().catch(() => { process.stderr.write('Opus probe setup failed; private inputs and credentials are omitted.\n'); process.exitCode = 1; });
module.exports = { MODEL, COUNT_MODEL, BASE_URL, MANTLE_COUNT_URL, TIMEOUT_MS, MAX_RESPONSE_BYTES, DEFAULT_CASE_ID, DEFAULT_LANGUAGE,
  COST_CEILING_USD, RESERVED_COST_USD,
  INPUT_COUNT_ALLOWANCE_TOKENS, makeWireSchema, toConverse, promptFingerprint, maxOutputTokens, reportedCostUsd, requestJson,
  countTokens, infer, validateAjvOutput, validateAjvSchema, summarizeSemanticErrors, summarizeQualityMetrics, verifyCountReport, safeProviderFailure, main };
