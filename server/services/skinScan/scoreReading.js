const SkinScan = require('../../models/SkinScan');
const { computeSignals, SIGNAL_KEYS } = require('./signals');
const { completeJson, isConfigured } = require('../bedrock/client');
const { sanitizeQuiz, eligibleProducts } = require('../bedrock/analysisContract');
const { loadCatalogue } = require('../bedrock/catalogue');

// The written half of the Profile score section ("Start here", and per signal: potential
// score, weeks, what drags it, why, what moves it, shelf line, product). Bedrock writes it;
// this module asks once per complete scan and stores only the sanitized answer on the scan.
//
// Flow: GET /api/skin-scan/:id on a complete scan -> maybeRequestReading() claims the scan
// (readingStatus null -> 'pending'), calls Bedrock in the background and writes 'ready' or
// 'failed'. Only scans somebody is looking at cost a provider call, and a claim left 'pending'
// by a server restart is taken over by the next GET once it is STALE_PENDING_MS old.

const READING_TIMEOUT_MS = 45000; // Keep score-reading within the same provider deadline as Era analysis.
const STALE_PENDING_MS = 2 * 60 * 1000;

// Max lengths for generated strings; longer text is cut, not rejected.
const CAPS = {
  title: 80, body: 600, text: 400, weeks: 40, shelf: 200, productName: 120, actives: 160,
};
const SHELF_STATUSES = ['own', 'missing'];
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

// Trimmed, length-capped plain text, or null. Never interpreted as HTML by the app.
function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// Only absolute https links reach the app's "+" button (no http:, javascript:, data: ...).
function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// The body sent for score-reading: the whitelisted quiz answers stored at scan init
// (src/lib/skinScan.js scanQuizAnswers) plus the scores. Signals without a score are left out.
function buildReadingRequest(scan) {
  const view = computeSignals(scan.merged) || { overall: null, skinAge: null, skinType: null, signals: [] };
  return {
    quizAnswers: scan.quizSnapshot || {},
    // Language the reading copy must be written in ('en' | 'he'). Scans made before this field existed are English.
    language: scan.language || 'en',
    scan: {
      overall: view.overall,
      skinAge: view.skinAge,
      skinType: view.skinType,
      signals: view.signals.filter(s => s.score != null),
    },
  };
}

// One signal entry from the model -> the stored shape, or null when nothing in it is usable.
// `score` is today's signal score: a "possible" score must be an integer from score to 100.
function sanitizeSignal(entry, score) {
  const potential = Number.isInteger(entry.potential) && typeof score === 'number'
    && entry.potential >= score && entry.potential <= 100
    ? entry.potential
    : null;

  const shelfText = cleanText(entry.shelf?.text, CAPS.shelf);
  const shelf = shelfText && SHELF_STATUSES.includes(entry.shelf?.status)
    ? { status: entry.shelf.status, text: shelfText }
    : null;

  // A product needs a name; actives and the link are optional (no link -> no "+" button).
  const productName = cleanText(entry.product?.name, CAPS.productName);
  const product = productName
    ? {
      name: productName,
      actives: cleanText(entry.product.actives, CAPS.actives),
      url: httpsUrl(entry.product.url),
    }
    : null;

  const signal = {
    key: entry.key,
    potential,
    weeks: cleanText(entry.weeks, CAPS.weeks),
    driver: cleanText(entry.driver, CAPS.text),
    why: cleanText(entry.why, CAPS.text),
    lever: cleanText(entry.lever, CAPS.text),
    shelf,
    product,
  };
  const hasContent = Object.entries(signal).some(([k, v]) => k !== 'key' && v != null);
  return hasContent ? signal : null;
}

// Model JSON -> { startHere, signals } in the app's shape, or null when nothing is usable.
// Unknown keys are ignored; a bad signal entry is dropped on its own; one entry per signal key.
function sanitizeReading(body, signals = []) {
  if (!body || typeof body !== 'object') return null;
  const scoreByKey = Object.fromEntries(signals.map(s => [s.key, s.score]));

  const title = cleanText(body.start_here?.title, CAPS.title);
  const text = cleanText(body.start_here?.body, CAPS.body);
  const startHere = title && text ? { title, body: text } : null;

  const seen = new Set();
  const cleanSignals = [];
  for (const entry of Array.isArray(body.signals) ? body.signals.slice(0, 20) : []) {
    if (!entry || typeof entry !== 'object' || !SIGNAL_KEYS.includes(entry.key) || seen.has(entry.key)) continue;
    const signal = sanitizeSignal(entry, scoreByKey[entry.key]);
    if (signal) {
      seen.add(entry.key);
      cleanSignals.push(signal);
    }
  }

  if (!startHere && !cleanSignals.length) return null;
  return { startHere, signals: cleanSignals };
}

// What the app is told about the copy (see scanView). 'pending' also covers "never asked yet":
// the next GET /api/skin-scan/:id asks, so the app keeps polling.
function readingStatusFor(scan) {
  if (scan.readingStatus === 'ready' || scan.readingStatus === 'failed') return scan.readingStatus;
  return isConfigured() ? 'pending' : 'unavailable';
}

const readingSchema = {
  type: 'object', additionalProperties: false, required: ['start_here', 'signals'],
  properties: {
    start_here: { anyOf: [
      { type: 'null' },
      { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: {
        title: { type: 'string' }, body: { type: 'string' },
      } },
    ] },
    signals: { type: 'array', maxItems: 20, items: {
      type: 'object', additionalProperties: false,
      required: ['key', 'potential', 'weeks', 'driver', 'why', 'lever', 'shelf', 'product'],
      properties: {
        key: { type: 'string', enum: SIGNAL_KEYS },
        potential: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
        weeks: { type: ['string', 'null'] }, driver: { type: ['string', 'null'] },
        why: { type: ['string', 'null'] }, lever: { type: ['string', 'null'] },
        shelf: { anyOf: [
          { type: 'null' },
          { type: 'object', additionalProperties: false, required: ['status', 'text'], properties: {
            status: { type: 'string', enum: SHELF_STATUSES }, text: { type: 'string' },
          } },
        ] },
        product: { anyOf: [
          { type: 'null' },
          { type: 'object', additionalProperties: false, required: ['name', 'actives', 'url'], properties: {
            name: { type: 'string' }, actives: { type: ['string', 'null'] }, url: { type: ['string', 'null'] },
          } },
        ] },
      },
    } },
  },
};

async function callBedrock(scan) {
  const request = buildReadingRequest(scan);
  const safeRequest = { ...request, quizAnswers: sanitizeQuiz(request.quizAnswers) };
  // The version marker is stored only for scans whose original quiz included the safety answers.
  const safetyComplete = request.quizAnswers.safetyContextVersion === 1
    && hasCompleteSafetyAnswers(safeRequest.quizAnswers)
    && !hasReportedIngredientIrritant(safeRequest.quizAnswers);
  // Legacy snapshots may lack safety answers; still write score prose, but do not suggest products without explicit clearance.
  const catalogue = safetyComplete ? eligibleProducts(loadCatalogue(), safeRequest.quizAnswers) : [];
  safeRequest.eligible_catalogue = catalogue.map(product => ({
    name: product.name,
    keyActives: product.keyActives,
    ingredients: product.ingredients,
    pregnancy: product.pregnancy,
  }));
  const output = await completeJson({
    schema: readingSchema,
    schemaName: 'skin_score_reading',
    maxOutputTokens: 2_000,
    system: `Write concise, supportive score-reading copy in ${request.language === 'he' ? 'Hebrew' : 'English'} using only supplied quiz and score data. Never diagnose or promise a score change. Only mention a product whose exact name and ingredients appear in eligible_catalogue; otherwise set product to null. Never invent a product URL. Return start_here and signals in the required JSON shape.`,
    messages: [{ role: 'user', content: JSON.stringify(safeRequest) }],
    timeoutMs: READING_TIMEOUT_MS,
  });
  const productsByName = new Map(catalogue.map(product => [product.name.trim().toLowerCase(), product]));
  const verifiedOutput = {
    ...output,
    signals: (output.signals || []).map(signal => {
      const suggested = signal?.product;
      const product = suggested && productsByName.get(String(suggested.name || '').trim().toLowerCase());
      return {
        ...signal,
        product: product ? {
          name: product.name,
          actives: product.keyActives.join(', ').slice(0, CAPS.actives),
          url: null,
        } : null,
      };
    }),
  };
  const reading = sanitizeReading(verifiedOutput, request.scan.signals);
  if (!reading) throw new Error('BEDROCK_READING_INVALID');
  return reading;
}

// Asks Bedrock for the copy if this complete scan has none yet. Safe to call on every poll:
// the cheap checks on the loaded doc skip the DB in the common case, and the atomic
// findOneAndUpdate means concurrent polls can never start two paid calls for one scan.
// Resolves true when this call made the request. Never throws for a provider failure.
async function maybeRequestReading(scan, now = Date.now()) {
  if (!isConfigured() || !scan || scan.status !== 'complete') return false;
  if (scan.readingStatus === 'ready' || scan.readingStatus === 'failed') return false;
  const staleBefore = new Date(now - STALE_PENDING_MS);
  if (scan.readingStatus === 'pending' && scan.readingRequestedAt > staleBefore) return false;

  // Claim: never asked (null / missing), or a pending claim that went stale (server restart).
  const claimed = await SkinScan.findOneAndUpdate(
    {
      _id: scan._id,
      status: 'complete',
      $or: [
        { readingStatus: null },
        { readingStatus: 'pending', readingRequestedAt: { $lt: staleBefore } },
      ],
    },
    { $set: { readingStatus: 'pending', readingRequestedAt: new Date(now) } },
    { new: true }
  );
  if (!claimed) return false; // another poll won the claim

  let reading = null;
  try {
    reading = await callBedrock(claimed);
  } catch (err) {
    // Log only an error category; never include quiz answers, scores or upstream details.
    console.warn(`score-reading for scan ${claimed._id} failed: ${err.code || err.name || 'provider_error'}`);
  }

  // Written only while our claim still stands, so a late answer cannot overwrite a newer claim.
  // 'failed' is final (owner decision): the card then shows numbers only.
  await SkinScan.updateOne(
    { _id: claimed._id, readingStatus: 'pending', readingRequestedAt: claimed.readingRequestedAt },
    { $set: reading ? { reading, readingStatus: 'ready' } : { readingStatus: 'failed' } }
  );
  return true;
}

module.exports = {
  READING_TIMEOUT_MS,
  STALE_PENDING_MS,
  buildReadingRequest,
  sanitizeReading,
  readingSchema,
  callBedrock,
  readingStatusFor,
  maybeRequestReading,
};
