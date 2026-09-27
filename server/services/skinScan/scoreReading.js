const SkinScan = require('../../models/SkinScan');
const { computeSignals, SIGNAL_KEYS } = require('./signals');

// The written half of the Profile score section ("Start here", and per signal: potential
// score, weeks, what drags it, why, what moves it, shelf line, product). Gemini writes it on
// the Railway service; this module asks for it ONCE per complete scan and stores the
// sanitized answer on the scan. Contract: AI/plans/score-page.md ("Railway contract").
//
// Flow: GET /api/skin-scan/:id on a complete scan -> maybeRequestReading() claims the scan
// (readingStatus null -> 'pending'), calls Railway in the background and writes 'ready' or
// 'failed'. Only scans somebody is looking at cost a Gemini call, and a claim left 'pending'
// by a server restart is taken over by the next GET once it is STALE_PENDING_MS old.

const READING_TIMEOUT_MS = 45000; // same ceiling as the Era analysis call in the app
const STALE_PENDING_MS = 2 * 60 * 1000;

// Max lengths for Railway's strings; longer text is cut, not rejected.
const CAPS = {
  title: 80, body: 600, text: 400, weeks: 40, shelf: 200, productName: 120, actives: 160,
};
const SHELF_STATUSES = ['own', 'missing'];

// Unset -> the feature is off: nothing is requested or stored, and the app is told
// 'unavailable' (numbers only). Trailing slashes are dropped so `${base}/score-reading` is clean.
function railwayUrl() {
  const url = process.env.RAILWAY_API_URL;
  return typeof url === 'string' && url.trim() ? url.trim().replace(/\/+$/, '') : null;
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

// The body sent to Railway: the whitelisted quiz answers stored at scan init
// (src/lib/skinScan.js scanQuizAnswers) plus the scores. Signals without a score are left out.
function buildReadingRequest(scan) {
  const view = computeSignals(scan.merged) || { overall: null, skinAge: null, skinType: null, signals: [] };
  return {
    quizAnswers: scan.quizSnapshot || {},
    scan: {
      overall: view.overall,
      skinAge: view.skinAge,
      skinType: view.skinType,
      signals: view.signals.filter(s => s.score != null),
    },
  };
}

// One signal entry from Railway -> the stored shape, or null when nothing in it is usable.
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

// Railway's JSON -> { startHere, signals } in the app's shape, or null when nothing is usable.
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
  return railwayUrl() ? 'pending' : 'unavailable';
}

async function callRailway(base, scan) {
  const request = buildReadingRequest(scan);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READING_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/score-reading`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Railway score-reading ${res.status}`);
    const reading = sanitizeReading(await res.json(), request.scan.signals);
    if (!reading) throw new Error('Railway score-reading returned nothing usable');
    return reading;
  } finally {
    clearTimeout(timer);
  }
}

// Asks Railway for the copy if this complete scan has none yet. Safe to call on every poll:
// the cheap checks on the loaded doc skip the DB in the common case, and the atomic
// findOneAndUpdate means concurrent polls can never start two paid calls for one scan.
// Resolves true when this call made the request. Never throws for a Railway failure.
async function maybeRequestReading(scan, now = Date.now()) {
  const base = railwayUrl();
  if (!base || !scan || scan.status !== 'complete') return false;
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
    reading = await callRailway(base, claimed);
  } catch (err) {
    // Scan id + reason only: no quiz answers or scores in the logs.
    console.warn(`score-reading for scan ${claimed._id} failed: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
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
  readingStatusFor,
  maybeRequestReading,
};
