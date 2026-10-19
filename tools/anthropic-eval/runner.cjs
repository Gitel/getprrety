const fs = require('node:fs/promises');
const path = require('node:path');
const Ajv = require('ajv');
const { completeJson, MODEL, TIMEOUT_MS: ANTHROPIC_TIMEOUT_MS, MAX_OUTPUT_TOKENS: ANTHROPIC_MAX_OUTPUT_TOKENS,
  INPUT_USD_PER_MILLION, OUTPUT_USD_PER_MILLION } = require('../../server/services/anthropic/client');

const BASE_URL = 'https://api.anthropic.com/v1';
// The user selected 90 seconds; earlier reports retain their original deadlines.
const TIMEOUT_MS = ANTHROPIC_TIMEOUT_MS;
const MAX_OUTPUT_TOKENS = ANTHROPIC_MAX_OUTPUT_TOKENS;
const MAX_ATTEMPTS = 1;
// Match the shared Anthropic adapter's per-image validation bound before any provider call.
const MAX_IMAGE_BYTES = Math.floor(3.75 * 1024 * 1024);
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGES = 10;
const PRICING = Object.freeze({
  source: 'https://www.anthropic.com/pricing',
  inputPerMillionUsd: INPUT_USD_PER_MILLION,
  cachedInputPerMillionUsd: INPUT_USD_PER_MILLION,
  outputPerMillionUsd: OUTPUT_USD_PER_MILLION,
});

// Compute the evaluator's reported Anthropic cost from normalized usage.
function calculateCost(usage, pricing = PRICING) {
  const promptTokens = usage?.prompt_tokens;
  const outputTokens = usage?.completion_tokens;
  const cachedInputTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  if (![promptTokens, outputTokens, cachedInputTokens].every(value => Number.isSafeInteger(value) && value >= 0)
    || cachedInputTokens > promptTokens) return null;
  const uncachedInputTokens = promptTokens - cachedInputTokens;
  const usd = (
    uncachedInputTokens * pricing.inputPerMillionUsd
    + cachedInputTokens * pricing.cachedInputPerMillionUsd
    + outputTokens * pricing.outputPerMillionUsd
  ) / 1_000_000;
  return { promptTokens, cachedInputTokens, outputTokens, usd };
}

// Keep error output useful for debugging without exposing bearer credentials or long bodies.
function boundedError(value) {
  return String(value || 'Anthropic provider error').slice(0, 500);
}

function makeValidator(outputSchema) {
  return new Ajv({ allErrors: true, strict: true }).compile(outputSchema);
}

// Load one case's image bytes locally; only the contract's base64 image objects are sent.
async function loadCaseImages(caseDirectory, imageEntries = []) {
  if (!Array.isArray(imageEntries) || imageEntries.length > MAX_IMAGES) throw new Error('case images must be an array of at most 10 images');
  const allowedMediaTypes = new Set(['image/jpeg', 'image/png']);
  const skinAngles = new Set(['front', 'left', 'right', 'closeup', 'neck']);
  const seenSkinAngles = new Set();
  const images = [];
  let shelfCount = 0;
  let totalBytes = 0;
  for (const [index, entry] of imageEntries.entries()) {
    const mediaType = entry?.mediaType || entry?.contentType;
    if (!entry || !allowedMediaTypes.has(mediaType)) throw new Error(`image ${index} has an unsupported mediaType`);
    const suppliedAngle = String(entry.angle || 'unknown').toLowerCase();
    const isShelf = suppliedAngle === 'shelf' || /^shelf-\d+$/.test(suppliedAngle);
    if (isShelf) shelfCount += 1;
    else if (!skinAngles.has(suppliedAngle) || seenSkinAngles.has(suppliedAngle)) throw new Error(`image ${index} has an invalid or duplicate angle`);
    else seenSkinAngles.add(suppliedAngle);
    if (shelfCount > 5 || seenSkinAngles.size + shelfCount > MAX_IMAGES) throw new Error('case has too many images');
    let base64 = entry.base64;
    if (entry.path) {
      const fullPath = path.resolve(caseDirectory, entry.path);
      const relativePath = path.relative(path.resolve(caseDirectory), fullPath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new Error(`image ${index} path escapes its case folder`);
      if ((await fs.stat(fullPath)).size > MAX_IMAGE_BYTES) throw new Error(`image ${index} exceeds the 3.75 MiB limit`);
      base64 = (await fs.readFile(fullPath)).toString('base64');
    }
    const maxBase64Length = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
    if (typeof base64 !== 'string' || !base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new Error(`image ${index} needs valid base64 image data`);
    }
    if (base64.length > maxBase64Length) throw new Error(`image ${index} exceeds the 3.75 MiB limit`);
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.toString('base64') !== base64) throw new Error(`image ${index} needs valid base64 image data`);
    const validSignature = mediaType === 'image/jpeg'
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!validSignature) throw new Error(`image ${index} does not match its declared image type`);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`image ${index} exceeds the 3.75 MiB limit`);
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('case images exceed the 24 MiB total limit');
    images.push({ angle: isShelf ? 'shelf' : suppliedAngle, mediaType, base64 });
  }
  return images;
}

async function readCase(caseDirectory) {
  const caseFile = path.join(caseDirectory, 'case.json');
  const raw = JSON.parse(await fs.readFile(caseFile, 'utf8'));
  const caseId = raw.caseId || raw.id;
  if (typeof caseId !== 'string' || !caseId.trim()) throw new Error(`${caseFile} needs a stable caseId`);
  if (!raw.quiz || typeof raw.quiz !== 'object' || Array.isArray(raw.quiz)) throw new Error(`${caseFile} needs a quiz object`);
  return {
    caseId: caseId.trim(),
    quiz: raw.quiz,
    images: await loadCaseImages(caseDirectory, raw.images || []),
  };
}

async function readCatalogue(catalogueFile) {
  const parsed = JSON.parse(await fs.readFile(catalogueFile, 'utf8'));
  const catalogue = Array.isArray(parsed) ? parsed : parsed.catalogue || parsed.products;
  if (!Array.isArray(catalogue)) throw new Error('catalogue file must be an array or contain a catalogue/products array');
  // The checked-in seed catalogue has stable seedKey values instead of database _id values.
  return catalogue.map(product => product && !product._id && product.seedKey
    ? { ...product, _id: String(product.seedKey) }
    : product);
}

// Use the shared SDK adapter so the tool follows the same count, schema, cost, and retry policy as the service.
async function requestAttempt({ token, messages, outputSchema, completeImpl = completeJson, maxCostUsd = 0.25, timeoutMs = TIMEOUT_MS }) {
  const started = Date.now();
  let usageCost = null;
  let httpStatus = null;
  let finishReason = null;
  try {
    const system = messages.find(message => message.role === 'system')?.content || '';
    const conversation = messages.filter(message => message.role !== 'system');
    const output = await completeImpl({
      system, messages: conversation, schema: outputSchema, schemaName: 'skin_analysis',
      maxOutputTokens: MAX_OUTPUT_TOKENS, maxCostUsd, token, timeoutMs,
      onEvent(event) {
        if (Number.isInteger(event?.status)) httpStatus = event.status;
        if (['stop', 'completed', 'length', 'end_turn', 'stop_sequence'].includes(event?.finishReason)) finishReason = event.finishReason;
        if (event?.usage) {
          const calculated = calculateCost(event.usage);
          usageCost = calculated && { ...calculated, usd: Number.isFinite(event.costUsd) ? event.costUsd : calculated.usd };
        }
      },
    });
    return { status: 'candidate', httpStatus, latencyMs: Date.now() - started, usageCost, costUnknown: !usageCost, finishReason: finishReason || 'end_turn', output };
  } catch (error) {
    const code = String(error?.code || 'ANTHROPIC_PROVIDER_ERROR');
    const status = error?.status;
    const category = code === 'ANTHROPIC_TIMEOUT' || code === 'ANTHROPIC_CANCELLED' ? 'timeout'
      : code === 'ANTHROPIC_REFUSED' ? 'refusal'
        : code === 'ANTHROPIC_OUTPUT_TRUNCATED' ? 'truncated'
          : code === 'ANTHROPIC_NETWORK_ERROR' ? 'network_error'
            : /^ANTHROPIC_(?:WIRE|JSON|INVALID|FINISH|USAGE|COST|COUNT)/.test(code) ? 'invalid_output'
              : Number.isInteger(status) ? 'api_error' : 'network_error';
    return {
      status: category, httpStatus: Number.isInteger(status) ? status : httpStatus,
      latencyMs: Date.now() - started, usageCost, costUnknown: !usageCost,
      finishReason, error: boundedError(code),
    };
  }
}

function validateCandidate(output, { validator, contract, quiz, language, images, catalogue }) {
  const errors = [];
  if (!validator(output)) {
    for (const error of validator.errors || []) errors.push(`${error.instancePath || '/'} ${error.message || 'schema mismatch'}`);
  }
  try {
    const semantic = contract.validateOutput(output, { quiz, language, images }, catalogue);
    if (Array.isArray(semantic?.errors)) errors.push(...semantic.errors.map(String));
  } catch (error) {
    errors.push(`semantic validator failed: ${String(error?.message || error).slice(0, 300)}`);
  }
  return [...new Set(errors)];
}

// Run cases one language at a time and serialize provider calls to make cost auditable.
async function runEvaluations({ cases, languages, catalogue, contract, token, maxRunCostUsd = 3, maxAnalysisCostUsd = 0.25, maxAttempts = MAX_ATTEMPTS, completeImpl = completeJson, timeoutMs = TIMEOUT_MS, onAttempt = () => {} }) {
  // A single attempt is the safe default; two attempts remain available for explicit comparisons.
  if (!Number.isInteger(maxAttempts) || ![1, 2].includes(maxAttempts)) {
    throw new Error('maxAttempts must be either 1 or 2');
  }
  const outputSchema = contract.outputSchema;
  const validator = makeValidator(outputSchema);
  const results = [];
  let totalCostUsd = 0;
  let costUnknown = false;
  let stopReason = null;

  for (const testCase of cases) {
    for (const language of languages) {
      if (totalCostUsd >= maxRunCostUsd || costUnknown) {
        stopReason = costUnknown ? 'stopped because a previous attempt has unknown cost' : 'run cost cap reached';
        break;
      }
      const built = contract.buildMessages({ quiz: testCase.quiz, language, images: testCase.images, catalogue });
      if (!built || typeof built.system !== 'string' || !Array.isArray(built.messages)) {
        throw new Error('contract buildMessages must return { system: string, messages: array }');
      }
      const messages = [{ role: 'system', content: built.system }, ...built.messages];
      const attempts = [];
      let retryErrors = null;
      let validOutput = null;
      let analysisCostSoFar = 0;

      for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
        // Retry once only when a completed response failed output/contract validation.
        const attemptMessages = retryErrors
          ? [...messages, { role: 'user', content: `Your previous answer failed these checks: ${retryErrors.join('; ')}. Re-evaluate the same case and return a corrected JSON object.` }]
          : messages;
        const attempt = await requestAttempt({ token, messages: attemptMessages, outputSchema, completeImpl, maxCostUsd: maxAnalysisCostUsd, timeoutMs });
        attempt.number = attemptNumber;
        if (attempt.usageCost) {
          attempt.costUsd = attempt.usageCost.usd;
          totalCostUsd += attempt.usageCost.usd;
          analysisCostSoFar += attempt.usageCost.usd;
        } else {
          attempt.costUnknown = true;
          costUnknown = true;
        }

        if (attempt.status === 'candidate') {
          const errors = validateCandidate(attempt.output, { validator, contract, quiz: testCase.quiz, language, images: testCase.images, catalogue });
          if (errors.length) {
            attempt.status = 'invalid_output';
            attempt.validationErrors = errors;
            attempt.rawOutput = JSON.stringify(attempt.output);
            delete attempt.output;
            retryErrors = errors;
          } else {
            validOutput = attempt.output;
            attempt.status = 'valid';
          }
        }
        attempts.push(attempt);
        // Progress contains case metadata and metrics only; model output stays in the report file.
        onAttempt({
          caseId: testCase.caseId,
          language,
          attempt: attempt.number,
          status: attempt.status,
          latencyMs: attempt.latencyMs,
          costUsd: attempt.costUsd ?? null,
          finishReason: attempt.finishReason ?? null,
        });
        if (validOutput || !retryErrors || costUnknown || attemptNumber === maxAttempts || totalCostUsd >= maxRunCostUsd || analysisCostSoFar >= maxAnalysisCostUsd) break;
      }

      const analysisCost = attempts.some(a => a.costUnknown) ? null : attempts.reduce((sum, a) => sum + (a.costUsd || 0), 0);
      results.push({
        caseId: testCase.caseId,
        language,
        imageCount: testCase.images.length,
        status: validOutput ? 'valid' : attempts.at(-1)?.status || 'not_run',
        valid: Boolean(validOutput),
        withinAnalysisCostCeiling: analysisCost == null ? null : analysisCost <= maxAnalysisCostUsd,
        costUsd: analysisCost,
        attempts,
        output: validOutput,
      });
      if (costUnknown) stopReason = 'stopped because a provider attempt cost is unknown';
      if (analysisCost != null && analysisCost > maxAnalysisCostUsd) stopReason = 'logical analysis cost ceiling reached';
      else if (totalCostUsd >= maxRunCostUsd) stopReason = 'run cost cap reached';
      if (stopReason) break;
    }
    if (stopReason) break;
  }
  return {
    model: MODEL,
    endpoint: BASE_URL,
    maxCompletionTokens: MAX_OUTPUT_TOKENS,
    pricing: PRICING,
    maxRunCostUsd,
    maxAnalysisCostUsd,
    maxAttempts,
    totalCostUsd,
    costUnknown,
    stopReason,
    results,
  };
}

module.exports = {
  BASE_URL,
  MODEL,
  TIMEOUT_MS,
  MAX_OUTPUT_TOKENS,
  MAX_ATTEMPTS,
  PRICING,
  calculateCost,
  loadCaseImages,
  readCase,
  readCatalogue,
  requestAttempt,
  runEvaluations,
};
