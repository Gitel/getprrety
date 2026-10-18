#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Ajv = require('ajv');
const { execFileSync } = require('node:child_process');
const { completeJson, countTokens: anthropicCountTokens, MODEL: ANTHROPIC_MODEL, TIMEOUT_MS: ANTHROPIC_TIMEOUT_MS,
  MAX_OUTPUT_TOKENS: ANTHROPIC_MAX_OUTPUT_TOKENS, INPUT_USD_PER_MILLION, OUTPUT_USD_PER_MILLION } = require('../../server/services/anthropic/client');
const { outputSchema, validateOutput, eligibleProducts: selectEligibleProducts } = require('../../server/services/anthropic/analysisContract');
const { loadSeedCatalogue, loadSnapshotCatalogue } = require('../../server/services/anthropic/catalogue');
const { prepareSkinRequest } = require('../../server/services/anthropic/skinRequest');
const { COMPACT_CONTRACT_VERSION } = require('../../server/services/anthropic/compact');
const { readCase } = require('./runner.cjs');
const { parseArgs, isInside, getToken } = require('./run.cjs');
const { writeAtomicCheckpoint } = require('./investigate.cjs');

const ROOT = path.resolve(__dirname, '../..');
const MODEL = ANTHROPIC_MODEL;
const COUNT_MODEL = ANTHROPIC_MODEL;
const BASE_URL = 'https://api.anthropic.com/v1';
const COUNT_URL = `${BASE_URL}/messages/count_tokens`;
const TIMEOUT_MS = ANTHROPIC_TIMEOUT_MS;
const MAX_OUTPUT_TOKENS = ANTHROPIC_MAX_OUTPUT_TOKENS;
const COST_CEILING_USD = 0.25;
const RESERVED_COST_USD = 0.01;
// The prior free comparison found a 17-token count/use delta; keep a larger allowance and label the cap as estimated.
const INPUT_COUNT_ALLOWANCE_TOKENS = 128;
const DEFAULT_CASE_ID = 'case-568f7d2ab3';
const DEFAULT_LANGUAGE = 'en';

// Keep the compact output schema available to older fixture helpers and local validation tests.
function makeWireSchema(schema) {
  if (Array.isArray(schema)) return schema.map(makeWireSchema);
  if (!schema || typeof schema !== 'object') return schema;
  // Encode nullable objects compactly so the model receives the same small wire contract as validation.
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

// Pass the production prompt and image blocks unchanged to the shared Anthropic SDK adapter.
function toAnthropicInput(built, schema = makeWireSchema(outputSchema)) {
  return { system: built.system, messages: built.messages, schema };
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

// Keep the historical helper name for callers, but only the shared Anthropic SDK path can perform count requests.
async function countTokens({ system, messages, schema = outputSchema, wireSchema, token, timeoutMs = TIMEOUT_MS, onPhase = () => {}, countImpl = anthropicCountTokens }) {
  const started = performance.now();
  onPhase({ phase: 'request_start', elapsedMs: 0 });
  const counted = await countImpl({ system, messages, schema, schemaName: 'skin_analysis', wireSchema, token, timeoutMs });
  const elapsedMs = Math.round(performance.now() - started);
  onPhase({ phase: 'counted', elapsedMs, inputTokens: counted.inputTokens });
  return { inputTokens: counted.inputTokens, elapsedMs, providerRequestId: null };
}

// Send the same wire schema used by the count preflight and preserve usage for the evaluator's cost report.
async function infer({ system, messages, wireSchema, token, onPhase = () => {}, maxTokens, timeoutMs = TIMEOUT_MS, completeImpl = completeJson }) {
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > MAX_OUTPUT_TOKENS) throw new Error('output_budget_invalid');
  const started = performance.now();
  let usage = null;
  let costUsd = null;
  let inputTokens = null;
  let stopReason = 'end_turn';
  let outputTokenLimit = maxTokens;
  try {
    const output = await completeImpl({
      system, messages, schema: wireSchema, wireSchema, schemaName: 'skin_analysis',
      maxOutputTokens: maxTokens, maxCostUsd: COST_CEILING_USD, token, timeoutMs,
      onEvent(event) {
        onPhase(event);
        if (event?.phase === 'counted') {
          if (Number.isSafeInteger(event.inputTokens)) inputTokens = event.inputTokens;
          if (Number.isSafeInteger(event.outputTokenLimit)) outputTokenLimit = event.outputTokenLimit;
        }
        if (event?.usage) { usage = safeUsage(event.usage); costUsd = Number.isFinite(event.costUsd) ? event.costUsd : reportedCostUsd(usage); }
        if (event?.phase === 'complete' && typeof event.finishReason === 'string') stopReason = event.finishReason;
      },
    });
    return { output, usage, costUsd, stopReason, inputTokens, outputTokenLimit, elapsedMs: Math.round(performance.now() - started), providerRequestId: null };
  } catch (error) {
    return { output: null, parseError: error?.code || 'ANTHROPIC_INVALID_RESPONSE', httpStatus: error?.status, usage, costUsd, inputTokens,
      stopReason: 'other', outputTokenLimit, elapsedMs: Math.round(performance.now() - started), providerRequestId: null };
  }
}

function errorCategory(error) {
  if (['ANTHROPIC_NOT_CONFIGURED', 'ANTHROPIC_HTTP_401', 'ANTHROPIC_HTTP_403'].includes(error?.code)) return 'access';
  if (error?.code === 'ANTHROPIC_HTTP_404') return 'model';
  if (error?.code === 'ANTHROPIC_HTTP_429') return 'throttled';
  if (error?.code === 'ANTHROPIC_TIMEOUT' || error?.code === 'ANTHROPIC_CANCELLED') return 'timeout';
  if (error?.code?.includes('COUNT')) return 'count';
  if (error?.code?.includes('COST') || error?.code?.includes('USAGE')) return 'cost';
  if (error?.code?.includes('SCHEMA')) return 'schema';
  if (error?.code?.includes('JSON') || error?.code?.includes('INVALID') || error?.code?.includes('REFUSED')) return 'response';
  if (Number.isInteger(error?.status) && error.status >= 500) return 'service';
  return error?.category || 'request';
}

function safeUsage(usage) {
  const inputTokens = usage?.inputTokens ?? usage?.prompt_tokens;
  const outputTokens = usage?.outputTokens ?? usage?.completion_tokens;
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || inputTokens < 0 || outputTokens < 0) return null;
  return { inputTokens, outputTokens,
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
    && report.provider === 'anthropic' && report.model === MODEL && report.countModel === COUNT_MODEL
    && report.countApi === 'anthropic-sdk' && report.countMethod === 'anthropic-messages-count-tokens-v1' && report.schemaAwareCount === true
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
  // The count and inference adapters receive the same production prompt and schema.
  const request = toAnthropicInput(prepared, wireSchema);
  const countInput = { ...request, schema: outputSchema, wireSchema };
  const promptSha256 = promptFingerprint(countInput);
  const countApi = mode === 'count' ? 'anthropic-sdk' : undefined;
  const metadata = { generatedAt: new Date().toISOString(), mode, provider: 'anthropic', model: MODEL, countModel: COUNT_MODEL, timeoutMs: TIMEOUT_MS, automaticRetries: 0,
    ...(mode === 'count' ? { countApi, countMethod: 'anthropic-messages-count-tokens-v1', schemaAwareCount: true,
      inputCountAllowanceTokens: INPUT_COUNT_ALLOWANCE_TOKENS,
      costGate: 'estimate_not_guarantee_with_128_input_token_allowance_and_0.01_usd_output_reserve' } : {}),
    caseId, language, imageCount: testCase.images.length, stream: false, tier: 'default', promptSha256,
    compactContractVersion: COMPACT_CONTRACT_VERSION,
    productionPromptSha256: promptFingerprint({ system: prepared.system, messages: prepared.messages }), schemaSha256: promptFingerprint(outputSchema), wireSchemaSha256: promptFingerprint(wireSchema),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    pricing: { inputUsdPerMillion: INPUT_USD_PER_MILLION, outputUsdPerMillion: OUTPUT_USD_PER_MILLION, source: 'https://www.anthropic.com/pricing' } };
  const token = (deps.getToken || getToken)(options['server-dir']);
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
      const counted = await countTokens({ ...countInput, token, onPhase, countImpl: deps.countTokensImpl });
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
      const inferred = await infer({ ...request, token, maxTokens: report.outputTokenLimit, onPhase, completeImpl: deps.completeImpl });
      // Preserve reported usage even if parsing or local validation subsequently rejects the analysis.
      Object.assign(report, {
        usage: inferred.usage, costUsd: inferred.costUsd, costUnknown: inferred.costUsd === null,
        stopReason: ['end_turn', 'stop_sequence'].includes(inferred.stopReason) ? inferred.stopReason : 'other',
        inputTokens: inferred.inputTokens,
        outputTokenLimit: inferred.outputTokenLimit,
        elapsedMs: inferred.elapsedMs, providerRequestId: inferred.providerRequestId,
      });
      if (inferred.parseError) throw Object.assign(new Error('analysis_failed'), { code: inferred.parseError, status: inferred.httpStatus });
      if (report.costUnknown || report.costUsd > COST_CEILING_USD) throw Object.assign(new Error('cost_invalid'), { category: 'cost' });
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
    report.failureCategory = errorCategory(error);
    if (Number.isInteger(error.status) && error.status >= 100 && error.status <= 599) report.httpStatus = error.status;
    if (error.code) report.failureReason = error.code;
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
module.exports = { MODEL, COUNT_MODEL, BASE_URL, COUNT_URL, TIMEOUT_MS, DEFAULT_CASE_ID, DEFAULT_LANGUAGE,
  COST_CEILING_USD, RESERVED_COST_USD,
  INPUT_COUNT_ALLOWANCE_TOKENS, makeWireSchema, toAnthropicInput, promptFingerprint, maxOutputTokens, reportedCostUsd,
  countTokens, infer, safeUsage, validateAjvOutput, validateAjvSchema, summarizeSemanticErrors, summarizeQualityMetrics, verifyCountReport, main };
