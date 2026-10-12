const router = require('express').Router();
const { randomUUID } = require('node:crypto');
const requireAuth = require('../middleware/auth');
const { consumeRateLimit } = require('../services/rateLimit');
const { completeJson, BedrockError, TIMEOUT_MS } = require('../services/bedrock/client');
const { loadCatalogue } = require('../services/bedrock/catalogue');
const {
  outputSchema, buildMessages, validateOutput, sanitizeQuiz,
  allergiesFromQuiz, activeIrritantClasses, eligibilityLimitations, isPregnancyCaution,
} = require('../services/bedrock/analysisContract');
const { enforceAnalysisBudget } = require('../services/bedrock/analysisBudget');
const { ANALYSIS_SERVER_TIMEOUT_MS, RESPONSE_RESERVE_MS, logAnalysisPhase } = require('../services/bedrock/analysisDeadline');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGES = 10;
const MAX_QUIZ_BYTES = 32 * 1024;
const SKIN_ANGLES = new Set(['front', 'left', 'right', 'closeup', 'neck']);
const NON_INGREDIENT_IRRITANTS = new Set(['none', 'nothing', 'no', 'no irritants', 'cold', 'hot_water']);
const HEARTBEAT_MS = 10_000;

function isSseRequest(req) {
  return String(req.get?.('accept') || req.headers?.accept || '').split(',').some(value => value.trim().startsWith('text/event-stream'));
}

function sendSse(res, event, data) {
  if (res.writableEnded || res.destroyed) return false;
  return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function safeTelemetry(requestId, event) {
  const allowed = ['request_start', 'headers', 'first_body', 'first_content', 'last_content', 'body_end', 'validated', 'usage', 'complete', 'timeout', 'cancelled', 'error'];
  if (!allowed.includes(event.phase)) return;
  // Copy only approved metrics so a future provider event cannot leak model text into logs.
  const record = { requestId, phase: event.phase };
  if (Number.isSafeInteger(event.elapsedMs) && event.elapsedMs >= 0) record.providerElapsedMs = event.elapsedMs;
  if (Number.isSafeInteger(event.status) && event.status >= 100 && event.status <= 599) record.status = event.status;
  if (Number.isSafeInteger(event.contentBytes) && event.contentBytes >= 0) record.contentBytes = event.contentBytes;
  if (Number.isFinite(event.costUsd) && event.costUsd >= 0) record.costUsd = event.costUsd;
  if (typeof event.providerRequestId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(event.providerRequestId)) record.providerRequestId = event.providerRequestId;
  if (['stop', 'completed', 'length'].includes(event.finishReason)) record.finishReason = event.finishReason;
  if (typeof event.code === 'string' && /^(BEDROCK_[A-Z0-9_]+|ANALYSIS_[A-Z0-9_]+)$/.test(event.code)) record.code = event.code;
  if (event.phase === 'usage' && event.usage) {
    const usage = event.usage;
    if ([usage.prompt_tokens, usage.completion_tokens, usage.prompt_tokens_details?.cached_tokens].every(value => Number.isSafeInteger(value) && value >= 0)) {
      record.usage = {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        prompt_tokens_details: { cached_tokens: usage.prompt_tokens_details.cached_tokens },
      };
      const reasoning = usage.completion_tokens_details?.reasoning_tokens;
      if (Number.isSafeInteger(reasoning) && reasoning >= 0) record.usage.completion_tokens_details = { reasoning_tokens: reasoning };
    }
  }
  console.info('analysis-provider', JSON.stringify(record));
}

function withSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(Object.assign(new Error('Analysis cancelled'), { name: 'AbortError' }));
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(Object.assign(new Error('Analysis cancelled'), { name: 'AbortError' }));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', onAbort));
}

function analysisDeadline(req) {
  if (req.analysisDeadline) return req.analysisDeadline;
  const controller = new AbortController();
  const startedAt = Date.now();
  const deadline = {
    requestId: randomUUID(), startedAt, expiresAt: startedAt + ANALYSIS_SERVER_TIMEOUT_MS,
    controller, disconnected: false,
  };
  logAnalysisPhase(deadline, 'ingress');
  return deadline;
}

function hasCompleteSafetyAnswers(quiz) {
  const pregnancy = quiz.pregnant_or_ttc ?? quiz.pregnancy_caution;
  const pregnancyAnswered = typeof pregnancy === 'boolean' || pregnancy === 'yes' || pregnancy === 'no';
  const hasAnswer = value => Array.isArray(value) && value.some(item => typeof item === 'string' && item.trim());
  return pregnancyAnswered && hasAnswer(quiz.allergies) && hasAnswer(quiz.irritants);
}

function hasReportedIngredientIrritant(quiz) {
  const reports = [quiz.irritants, quiz.irritants_other].flatMap(value => Array.isArray(value) ? value : [value]);
  return reports.some(value => typeof value === 'string'
    && value.trim() && !NON_INGREDIENT_IRRITANTS.has(value.trim().toLowerCase()));
}

function minimizedQuiz(value) {
  const quiz = sanitizeQuiz(value);
  if (Buffer.byteLength(JSON.stringify(quiz), 'utf8') > MAX_QUIZ_BYTES) throw new Error('INVALID_INPUT');
  return quiz;
}

function decodeAnalysisImages(value) {
  if (!Array.isArray(value) || value.length > MAX_IMAGES) throw new Error('INVALID_INPUT');
  let totalBytes = 0;
  let shelfCount = 0;
  const seenSkinAngles = new Set();
  return value.map(image => {
    const angle = image?.angle;
    const mediaType = image?.mediaType;
    const base64 = image?.base64;
    if (typeof angle !== 'string' || (!SKIN_ANGLES.has(angle) && angle !== 'shelf')) throw new Error('INVALID_INPUT');
    if (angle === 'shelf') shelfCount += 1;
    else if (seenSkinAngles.has(angle)) throw new Error('INVALID_INPUT');
    else seenSkinAngles.add(angle);
    if (shelfCount > 5 || !['image/jpeg', 'image/png'].includes(mediaType) || typeof base64 !== 'string'
      || !base64 || base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4 || base64.length % 4 === 1
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('INVALID_INPUT');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('INVALID_INPUT');
    const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if ((mediaType === 'image/jpeg' && !jpeg) || (mediaType === 'image/png' && !png)) throw new Error('INVALID_INPUT');
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('INVALID_INPUT');
    return { angle, mediaType, base64 };
  });
}

// Pre-signup analysis spends provider tokens, so validate the minimized input and budget it before calling Bedrock.
router.post('/analyze-skin', async (req, res) => {
  if (res.writableEnded || res.destroyed || req.analysisDeadline?.disconnected) return;
  const wantsSse = isSseRequest(req);
  const deadline = analysisDeadline(req);
  const requestId = deadline.requestId;
  let heartbeat;
  let headersStarted = false;
  const event = (name, payload) => {
    if (!wantsSse) return;
    sendSse(res, name, { requestId, ...payload });
  };
  const endSse = () => {
    if (!res.writableEnded && !res.destroyed) res.end();
  };
  const beginEvents = () => {
    if (!wantsSse || headersStarted) return;
    headersStarted = true;
    res.status(200);
    res.set('Content-Type', 'text/event-stream; charset=utf-8');
    res.set('Cache-Control', 'no-cache, no-transform');
    res.set('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    event('progress', { phase: 'waiting' });
    // Small comments keep proxies awake while expensive setup or model generation is pending.
    heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed && !res.writableNeedDrain) res.write(': keep-alive\n\n');
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
  };
  const finishEvents = () => clearInterval(heartbeat);
  try {
    if (wantsSse) beginEvents();
    const body = req.body;
    logAnalysisPhase(deadline, 'parsed');
    if (!body || typeof body !== 'object' || Array.isArray(body) || !body.quizAnswers || typeof body.quizAnswers !== 'object' || Array.isArray(body.quizAnswers)) {
      if (wantsSse) { event('error', { error: 'Invalid analysis request', status: 400, code: 'INVALID_INPUT' }); return endSse(); }
      return res.status(400).json({ error: 'Invalid analysis request' });
    }
    const language = body.language;
    if (language !== 'en' && language !== 'he') {
      if (wantsSse) { event('error', { error: 'Invalid analysis request', status: 400, code: 'INVALID_INPUT' }); return endSse(); }
      return res.status(400).json({ error: 'Invalid analysis request' });
    }
    const images = decodeAnalysisImages(body.images || []);
    const quiz = minimizedQuiz(body.quizAnswers);
    const quizBytes = Buffer.byteLength(JSON.stringify(quiz), 'utf8');
    logAnalysisPhase(deadline, 'budget_start', { imageCount: images.length, quizBytes });
    const allowed = await withSignal(enforceAnalysisBudget(req.ip || req.socket?.remoteAddress), deadline.controller.signal);
    logAnalysisPhase(deadline, 'budget_complete', { status: allowed ? 200 : 429 });
    if (!allowed) {
      if (wantsSse) { event('error', { error: 'Analysis rate limit exceeded', status: 429, code: 'RATE_LIMITED' }); return endSse(); }
      return res.status(429).json({ error: 'Analysis rate limit exceeded' });
    }

    const catalogue = loadCatalogue();
    logAnalysisPhase(deadline, 'catalogue_loaded', { catalogueCount: Array.isArray(catalogue) ? catalogue.length : 0 });
    const prompt = buildMessages({ quiz, language, images, catalogue });
    logAnalysisPhase(deadline, 'prompt_ready', {
      messageCount: Array.isArray(prompt.messages) ? prompt.messages.length : 0,
    });
    const remainingMs = Math.min(TIMEOUT_MS, deadline.expiresAt - Date.now() - RESPONSE_RESERVE_MS);
    if (remainingMs <= 0 || deadline.controller.signal.aborted) throw new BedrockError('BEDROCK_TIMEOUT', 504);
    logAnalysisPhase(deadline, 'provider_start');
    const output = await completeJson({
      ...prompt,
      schema: outputSchema,
      stream: wantsSse,
      signal: deadline.controller.signal,
      timeoutMs: remainingMs,
      onEvent: providerEvent => {
        safeTelemetry(requestId, providerEvent);
        if (providerEvent.phase === 'first_content') event('progress', { phase: 'generating' });
      },
    });
    if (wantsSse) event('progress', { phase: 'validating' });
    const validation = validateOutput(output, { quiz, language, images }, catalogue);
    // Synchronous schema/contract checks cannot be interrupted by AbortController timers.
    if (deadline.controller.signal.aborted || Date.now() >= deadline.expiresAt) throw new BedrockError('BEDROCK_TIMEOUT', 504);
    if (validation.errors.length) {
      logAnalysisPhase(deadline, 'semantic_invalid', { status: 502, code: 'BEDROCK_CONTRACT_INVALID' });
      throw new BedrockError('BEDROCK_CONTRACT_INVALID');
    }
    logAnalysisPhase(deadline, 'semantic_validated', { status: 200 });
    if (deadline.disconnected || res.destroyed) return;
    if (wantsSse) { event('complete', { analysis: { ...output, source: 'bedrock' } }); return endSse(); }
    return res.json({ ...output, source: 'bedrock' });
  } catch (error) {
    finishEvents();
    if (deadline.disconnected || res.destroyed) return;
    const errorCode = error?.message === 'INVALID_INPUT' ? 'INVALID_INPUT'
      : error?.message === 'Analysis budget is unavailable' ? 'ANALYSIS_UNAVAILABLE'
        : (typeof error?.code === 'string' && /^(BEDROCK_[A-Z0-9_]+|ANALYSIS_[A-Z0-9_]+)$/.test(error.code) ? error.code : 'ANALYSIS_FAILED');
    const fallbackStatus = error?.message === 'INVALID_INPUT' ? 400
      : error?.message === 'Analysis budget is unavailable' ? 503
        : error?.name === 'AbortError' ? (deadline.controller.signal.reason === 'CANCELLED' ? 499 : 504) : 500;
    logAnalysisPhase(deadline, 'route_error', {
      status: Number.isSafeInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : fallbackStatus,
      code: errorCode,
    });
    if (error?.message === 'INVALID_INPUT') {
      if (wantsSse) { event('error', { error: 'Invalid analysis request', status: 400, code: 'INVALID_INPUT' }); return endSse(); }
      return res.status(400).json({ error: 'Invalid analysis request' });
    }
    if (error instanceof BedrockError || error?.name === 'AbortError') {
      const code = error.code || (deadline.controller.signal.reason === 'CANCELLED' ? 'BEDROCK_CANCELLED' : 'BEDROCK_TIMEOUT');
      const status = error.status || (code === 'BEDROCK_CANCELLED' ? 499 : 504);
      const message = status === 503 ? 'Analysis is unavailable' : 'Analysis provider failed';
      if (wantsSse) { event('error', { error: message, status, code }); return endSse(); }
      return res.status(status).json({ error: message });
    }
    // Never include quiz, image, provider-body, or raw exception details in the response.
    if (error?.message === 'Analysis budget is unavailable') {
      if (wantsSse) { event('error', { error: 'Analysis is unavailable', status: 503, code: 'ANALYSIS_UNAVAILABLE' }); return endSse(); }
      return res.status(503).json({ error: 'Analysis is unavailable' });
    }
    if (wantsSse) { event('error', { error: 'Analysis is unavailable', status: 500, code: 'ANALYSIS_FAILED' }); return endSse(); }
    return res.status(500).json({ error: 'Analysis is unavailable' });
  } finally {
    finishEvents();
  }
});

function cleanRecommendationList(value, maxIndex) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxIndex).map(item => {
    const index = Number(item?.index);
    const rec = item?.rec;
    if (!Number.isInteger(index) || index < 0 || index >= maxIndex || !rec || typeof rec !== 'object') return null;
    const rawUrl = typeof rec.url === 'string' ? rec.url.trim() : '';
    return {
      index,
      rec: {
        brand: String(rec.brand || '').slice(0, 100),
        name: String(rec.name || '').slice(0, 160),
        price: String(rec.price || '').slice(0, 50),
        retailer: String(rec.retailer || '').slice(0, 100),
        url: /^https:\/\//i.test(rawUrl) ? rawUrl.slice(0, 1000) : '',
      },
    };
  }).filter(Boolean);
}

router.post('/product-recommendations', requireAuth, async (req, res) => {
  try {
    const allowed = await consumeRateLimit(
      'ai_user',
      req.user.id,
      process.env.AI_REQUESTS_PER_USER_HOUR || 10
    );
    if (!allowed) return res.status(429).json({ error: 'Rate limit exceeded' });

    const { productAudit = {}, country = '', eraName = '' } = req.body || {};
    const add = Array.isArray(productAudit.add) ? productAudit.add.slice(0, 10) : [];
    const replace = Array.isArray(productAudit.replace) ? productAudit.replace.slice(0, 10) : [];
    if (!add.length && !replace.length) return res.json({ add: [], replace: [] });

    const safeCountry = String(country).slice(0, 100);
    const safeEra = String(eraName).slice(0, 100);
    const needs = [
      ...add.map((item, index) => `[add_${index}] [ADD] ${String(item.product || '').slice(0, 200)}`),
      ...replace.map((item, index) =>
        `[replace_${index}] [REPLACE] ${String(item.from || '').slice(0, 120)} with ${String(item.to || '').slice(0, 200)}`
      ),
    ].join('\n');
    const quiz = minimizedQuiz(req.body?.quizAnswers || req.body?.safetyContext || {});
    const safetyContext = {
      allergies: allergiesFromQuiz(quiz),
      irritants: activeIrritantClasses(quiz),
      pregnancyCaution: isPregnancyCaution(quiz),
      limitations: eligibilityLimitations(quiz),
    };
    // Market products lack verified ingredients, so require complete answers and suppress unknown as well as known restrictions.
    if (!hasCompleteSafetyAnswers(quiz) || safetyContext.allergies.length || safetyContext.irritants.length
      || hasReportedIngredientIrritant(quiz) || safetyContext.pregnancyCaution) {
      return res.json({ add: [], replace: [] });
    }
    const recommendationSchema = {
      type: 'object', additionalProperties: false, required: ['add', 'replace'],
      properties: {
        add: { type: 'array', maxItems: add.length, items: recommendationItemSchema(add.length) },
        replace: { type: 'array', maxItems: replace.length, items: recommendationItemSchema(replace.length) },
      },
    };
    const system = 'Recommend reputable skincare products sold in the requested country. Avoid products whose ingredients conflict with the supplied allergies, irritants, or pregnancy caution. Product ingredient lists are not supplied, so never claim a recommendation is allergy-safe or pregnancy-safe; if safety cannot be assessed, return an empty list for that item. Use only HTTPS URLs and return the requested strict JSON object.';
    const messages = [{ role: 'user', content: `Country: ${safeCountry}\nSkin Era: ${safeEra}\nSafety context: ${JSON.stringify(safetyContext)}\nNeeds:\n${needs}` }];
    const parsed = await completeJson({
      system,
      messages,
      schema: recommendationSchema,
      schemaName: 'product_recommendations',
      maxOutputTokens: 1_000,
    });
    res.json({
      add: cleanRecommendationList(parsed?.add, add.length),
      replace: cleanRecommendationList(parsed?.replace, replace.length),
    });
  } catch (error) {
    if (error instanceof BedrockError && error.status === 503) return res.status(503).json({ error: 'Recommendations are unavailable' });
    if (error?.message === 'INVALID_INPUT') return res.status(400).json({ error: 'Invalid recommendation request' });
    res.status(502).json({ error: 'Recommendation service failed' });
  }
});

function recommendationItemSchema(maxLength) {
  return {
    type: 'object', additionalProperties: false, required: ['index', 'rec'],
    properties: {
      index: { type: 'integer', minimum: 0, maximum: Math.max(0, maxLength - 1) },
      rec: { type: 'object', additionalProperties: false, required: ['brand', 'name', 'price', 'url', 'retailer'], properties: {
        brand: { type: 'string' }, name: { type: 'string' }, price: { type: 'string' }, url: { type: 'string' }, retailer: { type: 'string' },
      } },
    },
  };
}

module.exports = router;
// Also used by services/analysisFields.js to sanitize admin-edited product picks with
// exactly the same rules (https-only links, bounded indexes, capped lengths).
module.exports.cleanRecommendationList = cleanRecommendationList;
