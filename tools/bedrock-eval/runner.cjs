const fs = require('node:fs/promises');
const path = require('node:path');
const Ajv = require('ajv');

const BASE_URL = 'https://bedrock-mantle.us-west-2.api.aws/openai/v1';
const MODEL = 'xai.grok-4.6';
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 8_000;
const MAX_ATTEMPTS = 1;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGES = 10;
const PRICING = Object.freeze({
  source: 'https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-6.html',
  checkedAt: '2026-10-08',
  inputPerMillionUsd: 2.2,
  cachedInputPerMillionUsd: 0.55,
  outputPerMillionUsd: 6.6,
});

// Compute the billed standard-tier amount from Bedrock's reported token usage.
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
function boundedError(value, token) {
  return String(value || 'Unknown Bedrock error').replaceAll(token, '[REDACTED]').slice(0, 500);
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
      if ((await fs.stat(fullPath)).size > MAX_IMAGE_BYTES) throw new Error(`image ${index} exceeds the 8 MiB limit`);
      base64 = (await fs.readFile(fullPath)).toString('base64');
    }
    const maxBase64Length = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
    if (typeof base64 !== 'string' || !base64 || base64.length > maxBase64Length || base64.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new Error(`image ${index} needs valid base64 image data`);
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.toString('base64') !== base64) throw new Error(`image ${index} needs valid base64 image data`);
    const validSignature = mediaType === 'image/jpeg'
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!validSignature) throw new Error(`image ${index} does not match its declared image type`);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`image ${index} exceeds the 8 MiB limit`);
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

function contentAsText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
  }
  return '';
}

// Make a single bounded provider request. Network/API failures are recorded, never retried.
async function requestAttempt({ token, messages, outputSchema, fetchImpl = fetch, timeoutMs = TIMEOUT_MS }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        reasoning_effort: 'low',
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'skin_analysis', strict: true, schema: outputSchema },
        },
      }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    // Include time spent receiving the body, not only time to response headers.
    const latencyMs = Date.now() - started;
    let body;
    try { body = JSON.parse(bodyText); } catch { body = null; }
    const usageCost = calculateCost(body?.usage);
    if (!response.ok) {
      const message = body?.error?.message || body?.message || bodyText || response.statusText;
      return { status: 'api_error', httpStatus: response.status, latencyMs, usageCost, costUnknown: !usageCost, error: boundedError(message, token) };
    }
    const choice = body?.choices?.[0];
    const outputText = contentAsText(choice?.message);
    if (choice?.message?.refusal) {
      return { status: 'refusal', httpStatus: response.status, latencyMs, usageCost, costUnknown: !usageCost, finishReason: choice.finish_reason || null, error: boundedError(choice.message.refusal, token) };
    }
    if (choice?.finish_reason === 'length') {
      return { status: 'truncated', httpStatus: response.status, latencyMs, usageCost, costUnknown: !usageCost, finishReason: 'length', error: 'Completion ended at the output-token limit' };
    }
    if (!['stop', 'completed'].includes(choice?.finish_reason)) {
      return { status: 'invalid_output', httpStatus: response.status, latencyMs, usageCost, costUnknown: !usageCost,
        finishReason: choice?.finish_reason || null, validationErrors: ['response finish reason is missing or incomplete'] };
    }
    let output;
    try { output = JSON.parse(outputText); }
    catch {
      return { status: 'invalid_output', httpStatus: response.status, latencyMs, usageCost, costUnknown: !usageCost, finishReason: choice?.finish_reason || null, rawOutput: outputText, validationErrors: ['response content is not valid JSON'] };
    }
    return { status: 'candidate', httpStatus: response.status, latencyMs, usageCost, costUnknown: !usageCost, finishReason: choice?.finish_reason || null, output };
  } catch (error) {
    return {
      status: error?.name === 'AbortError' ? 'timeout' : 'network_error',
      httpStatus: null,
      latencyMs: Date.now() - started,
      usageCost: null,
      costUnknown: true,
      error: boundedError(error?.message || error, token),
    };
  } finally {
    clearTimeout(timeout);
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
async function runEvaluations({ cases, languages, catalogue, contract, token, maxRunCostUsd = 3, maxAnalysisCostUsd = 0.25, maxAttempts = MAX_ATTEMPTS, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, onAttempt = () => {} }) {
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
        const attempt = await requestAttempt({ token, messages: attemptMessages, outputSchema, fetchImpl, timeoutMs });
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
    reasoningEffort: 'low',
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
