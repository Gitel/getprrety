const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const { consumeRateLimit } = require('../services/rateLimit');
const { completeJson, BedrockError } = require('../services/bedrock/client');
const { loadCatalogue } = require('../services/bedrock/catalogue');
const {
  outputSchema, buildMessages, validateOutput, sanitizeQuiz,
  allergiesFromQuiz, activeIrritantClasses, eligibilityLimitations, isPregnancyCaution,
} = require('../services/bedrock/analysisContract');
const { enforceAnalysisBudget } = require('../services/bedrock/analysisBudget');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGES = 10;
const MAX_QUIZ_BYTES = 32 * 1024;
const SKIN_ANGLES = new Set(['front', 'left', 'right', 'closeup', 'neck']);
const NON_INGREDIENT_IRRITANTS = new Set(['none', 'nothing', 'no', 'no irritants', 'cold', 'hot_water']);

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
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !body.quizAnswers || typeof body.quizAnswers !== 'object' || Array.isArray(body.quizAnswers)) {
      return res.status(400).json({ error: 'Invalid analysis request' });
    }
    const language = body.language;
    if (language !== 'en' && language !== 'he') return res.status(400).json({ error: 'Invalid analysis request' });
    const images = decodeAnalysisImages(body.images || []);
    const quiz = minimizedQuiz(body.quizAnswers);
    const allowed = await enforceAnalysisBudget(req.ip || req.socket?.remoteAddress);
    if (!allowed) return res.status(429).json({ error: 'Analysis rate limit exceeded' });

    const catalogue = loadCatalogue();
    const prompt = buildMessages({ quiz, language, images, catalogue });
    const output = await completeJson({ ...prompt, schema: outputSchema });
    const validation = validateOutput(output, { quiz, language, images }, catalogue);
    if (validation.errors.length) throw new BedrockError('BEDROCK_CONTRACT_INVALID');
    return res.json({ ...output, source: 'bedrock' });
  } catch (error) {
    if (error?.message === 'INVALID_INPUT') return res.status(400).json({ error: 'Invalid analysis request' });
    if (error instanceof BedrockError) return res.status(error.status).json({ error: error.status === 503 ? 'Analysis is unavailable' : 'Analysis provider failed' });
    // Never include quiz, image, provider-body, or raw exception details in the response.
    if (error?.message === 'Analysis budget is unavailable') return res.status(503).json({ error: 'Analysis is unavailable' });
    return res.status(500).json({ error: 'Analysis is unavailable' });
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
