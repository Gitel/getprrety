'use strict';

// Admin-tunable AI settings (prompt guidance + limits) for the three AI tasks.
//
// Model: the NEWEST AiConfigVersion per key is live; no document = built-in defaults
// (defaults.js). Versions are never edited or deleted: saving and restoring both INSERT.
// Like services/catalogueProducts.js, the Mongoose model is the last argument ({ model })
// so unit tests can pass a fake instead of connecting to a database.

const mongoose = require('mongoose');
const AiConfigVersion = require('../../models/AiConfigVersion');
const { BOUNDS, DEFAULTS, KEYS, assembleSystem } = require('./defaults');

// A DB read must never slow down or fail an analysis (P6): give up after this long.
// maxTimeMS stops the server-side query; the race below also covers Mongoose's connection buffering.
const READ_TIMEOUT_MS = 2500;

function defaultsFor(key) {
  const def = DEFAULTS[key];
  if (!def) throw new Error(`Unknown AI config key: ${key}`);
  return def;
}

// Assemble the full system prompt: locked rules + (non-empty) guidance (+ compact rules for skin_analysis).
function buildSystem(key, guidance, language) {
  return assembleSystem(key, guidance, language);
}

// A stored limit is only trusted when it is inside the bounds; otherwise the default is used.
function safeLimit(value, bounds, fallback, integer) {
  const ok = typeof value === 'number' && Number.isFinite(value)
    && value >= bounds.min && value <= bounds.max && (!integer || Number.isInteger(value));
  return ok ? value : fallback;
}

// Turn a stored document (or null) into the shape callers use.
function toConfig(key, doc) {
  const def = defaultsFor(key);
  if (!doc) {
    return { guidance: def.defaultGuidance, limits: { ...def.defaultLimits }, versionId: null, source: 'default', savedBy: null, savedAt: null };
  }
  const stored = doc.limits || {};
  return {
    guidance: typeof doc.guidance === 'string' ? doc.guidance : '',
    limits: {
      timeoutSec: safeLimit(stored.timeoutSec, BOUNDS.timeoutSec, def.defaultLimits.timeoutSec, true),
      maxOutputTokens: safeLimit(stored.maxOutputTokens, BOUNDS.maxOutputTokens, def.defaultLimits.maxOutputTokens, true),
      maxCostUsd: safeLimit(stored.maxCostUsd, BOUNDS.maxCostUsd, def.defaultLimits.maxCostUsd, false),
    },
    versionId: String(doc._id),
    source: 'saved',
    savedBy: doc.createdBy || null,
    savedAt: doc.createdAt || null,
  };
}

// The live config for a key. NEVER throws for a DB problem: on a miss or any error the built-in
// defaults are returned (and a warning logged) so an analysis is never failed by a settings read.
async function getActiveConfig(key, { model = AiConfigVersion } = {}) {
  defaultsFor(key); // an unknown key is a programming error, not a DB problem
  let timer;
  try {
    const query = model.findOne({ key }).sort({ createdAt: -1 }).maxTimeMS(2000).lean();
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('read timed out')), READ_TIMEOUT_MS); });
    const doc = await Promise.race([query, timeout]);
    return toConfig(key, doc);
  } catch (err) {
    console.warn(`ai-config read failed for ${key}, using built-in defaults: ${err?.message || err}`);
    return toConfig(key, null);
  } finally {
    clearTimeout(timer);
  }
}

// ---- form validation ----

const num = value => (typeof value === 'number' ? value
  : typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : NaN);

// Validate the admin form / test-run body. Nothing is saved on any error.
// Returns { ok: true, values: { guidance, timeoutSec, maxOutputTokens, maxCostUsd, note } }
// or { ok: false, errors: { fieldName: message } }.
function parseConfigForm(body = {}) {
  const errors = {};
  const b = body && typeof body === 'object' ? body : {};

  // guidance: a string (empty is allowed). Browsers send CRLF line breaks; store LF.
  let guidance = '';
  if (b.guidance !== undefined && b.guidance !== null) {
    if (typeof b.guidance !== 'string') errors.guidance = 'Guidance must be text.';
    else guidance = b.guidance.replace(/\r\n/g, '\n').trim();
  }
  if (!errors.guidance && guidance.length > BOUNDS.guidanceMax) errors.guidance = `Guidance can be at most ${BOUNDS.guidanceMax} characters.`;

  let note = '';
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== 'string') errors.note = 'The note must be text.';
    else note = b.note.trim();
  }
  if (!errors.note && note.length > BOUNDS.noteMax) errors.note = `The note can be at most ${BOUNDS.noteMax} characters.`;

  const timeoutSec = num(b.timeoutSec);
  if (!Number.isInteger(timeoutSec) || timeoutSec < BOUNDS.timeoutSec.min || timeoutSec > BOUNDS.timeoutSec.max) {
    errors.timeoutSec = `Enter a whole number from ${BOUNDS.timeoutSec.min} to ${BOUNDS.timeoutSec.max}.`;
  }
  const maxOutputTokens = num(b.maxOutputTokens);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < BOUNDS.maxOutputTokens.min || maxOutputTokens > BOUNDS.maxOutputTokens.max) {
    errors.maxOutputTokens = `Enter a whole number from ${BOUNDS.maxOutputTokens.min} to ${BOUNDS.maxOutputTokens.max}.`;
  }
  const maxCostUsd = num(b.maxCostUsd);
  const cents = maxCostUsd * 100;
  // At most 2 decimals: the value in cents must be a whole number (tolerating float noise).
  if (!Number.isFinite(maxCostUsd) || Math.abs(cents - Math.round(cents)) > 1e-6
    || maxCostUsd < BOUNDS.maxCostUsd.min - 1e-9 || maxCostUsd > BOUNDS.maxCostUsd.max + 1e-9) {
    errors.maxCostUsd = `Enter an amount from ${BOUNDS.maxCostUsd.min.toFixed(2)} to ${BOUNDS.maxCostUsd.max.toFixed(2)} (up to 2 decimals).`;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, values: { guidance, timeoutSec, maxOutputTokens, maxCostUsd: Math.round(cents) / 100, note } };
}

// ---- versions ----

const sameConfig = (config, values) => config.guidance === values.guidance
  && config.limits.timeoutSec === values.timeoutSec
  && config.limits.maxOutputTokens === values.maxOutputTokens
  && config.limits.maxCostUsd === values.maxCostUsd;

// Save a new live version. `values` is the output of parseConfigForm (re-checked here so no
// caller can bypass the bounds). When guidance + limits equal the live config nothing is written.
// Returns { ok: true, changed: false } | { ok: true, changed: true, version } | { ok: false, errors }.
async function saveVersion(key, values, email, { model = AiConfigVersion } = {}) {
  defaultsFor(key);
  const parsed = parseConfigForm(values);
  if (!parsed.ok) return parsed;
  const v = parsed.values;
  const live = await getActiveConfig(key, { model });
  if (sameConfig(live, v)) return { ok: true, changed: false };
  const version = await model.create({
    key,
    guidance: v.guidance,
    limits: { timeoutSec: v.timeoutSec, maxOutputTokens: v.maxOutputTokens, maxCostUsd: v.maxCostUsd },
    note: v.note,
    createdBy: email,
    restoredFrom: null,
  });
  return { ok: true, changed: true, version };
}

// History for the admin page, newest first. Plain objects with a string `id`.
async function listVersions(key, limit = 50, { model = AiConfigVersion } = {}) {
  defaultsFor(key);
  const docs = await model.find({ key }).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map(doc => ({
    id: String(doc._id),
    guidance: doc.guidance || '',
    limits: doc.limits || {},
    note: doc.note || '',
    createdBy: doc.createdBy || '',
    restoredFrom: doc.restoredFrom || null,
    createdAt: doc.createdAt,
  }));
}

// Make an older version (or the built-in default) live again by INSERTING a copy with restoredFrom
// set; the history is never rewritten. Returns { ok: true, changed: true, version } or
// { ok: false, code: 'not_found' } for an unknown / malformed id or a version of another key.
async function restoreVersion(key, versionId, email, { model = AiConfigVersion } = {}) {
  const def = defaultsFor(key);
  let source;
  let restoredFrom;
  let note;
  if (versionId === 'default') {
    source = { guidance: def.defaultGuidance, limits: def.defaultLimits };
    restoredFrom = 'default';
    note = 'Restored built-in default';
  } else {
    if (typeof versionId !== 'string' || !/^[a-f0-9]{24}$/i.test(versionId) || !mongoose.Types.ObjectId.isValid(versionId)) {
      return { ok: false, code: 'not_found' };
    }
    // Filtering by key stops a version of another task from being restored here.
    source = await model.findOne({ _id: versionId, key }).lean();
    if (!source) return { ok: false, code: 'not_found' };
    restoredFrom = String(source._id);
    note = 'Restored an earlier version';
  }
  const version = await model.create({
    key,
    guidance: source.guidance || '',
    limits: { ...source.limits },
    note,
    createdBy: email,
    restoredFrom,
  });
  return { ok: true, changed: true, version };
}

module.exports = {
  KEYS, BOUNDS, DEFAULTS,
  getActiveConfig, buildSystem, parseConfigForm, saveVersion, listVersions, restoreVersion,
};
