// Admin edits to users and analyses. Each function validates the submitted form, writes
// with a single $set, and reports WHICH fields actually changed, so the route can audit
// field names and tell the admin "nothing changed" when that is the case.
const mongoose = require('mongoose');
const User = require('../models/User');
const SkinAnalysis = require('../models/SkinAnalysis');
const { isDuplicateEmail } = require('./duplicateKey');
const { text, sanitizeKeyInsights } = require('./analysisFields');
const { eraById } = require('./eras');

// Same shape check the app's signup uses (routes/auth.js).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMINGS = ['morning', 'night', 'both'];

// Values compared as strings so null / '' / undefined all count as "empty" and an
// unchanged form does not register as an edit.
function same(a, b) {
  return String(a == null ? '' : a) === String(b == null ? '' : b);
}

/**
 * Validate the user-page profile form.
 * Returns { updates } or { error } where error is a short code the route maps to a banner.
 * Empty optional fields are stored as null (the schema defaults) rather than ''.
 */
function parseProfileForm(body) {
  const src = body && typeof body === 'object' ? body : {};

  const email = text(src.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: 'profile_invalid_email' };

  const timing = text(src.skincareTiming, 20);
  if (timing && !TIMINGS.includes(timing)) return { error: 'profile_invalid_timing' };

  // Validate the whole input BEFORE using it: truncating first would turn "Israel" into
  // a valid-looking but wrong "IS" (Iceland).
  const country = text(src.country, 10).toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) return { error: 'profile_invalid_country' };

  return {
    updates: {
      firstName: text(src.firstName, 100) || null,
      email,
      skincareTiming: timing || null,
      city: text(src.city, 160) || null,
      country: country || null,
      // lat / lng / timezone are left alone: nothing in the app reads lat/lng, and they
      // are only ever written from the quiz's city answer (routes/analysis.js).
    },
  };
}

/**
 * Apply the profile form to a user.
 * Returns { ok: true, changed: [field names] } or { ok: false, code }.
 * A Google-linked account keeps its googleId: only the email address changes, so the
 * person can still sign in with Google (routes/auth.js looks the account up by
 * googleId OR email). Caution: because of that email match, setting an address that
 * belongs to SOMEONE ELSE's Google account would let that person sign into this one.
 */
async function updateUserProfile(id, body, { userModel = User } = {}) {
  if (!mongoose.isValidObjectId(id)) return { ok: false, code: 'user_notfound' };
  const parsed = parseProfileForm(body);
  if (parsed.error) return { ok: false, code: parsed.error };

  const current = await userModel.findById(id).select(Object.keys(parsed.updates).join(' ')).lean();
  if (!current) return { ok: false, code: 'user_notfound' };

  const changed = Object.keys(parsed.updates).filter(k => !same(current[k], parsed.updates[k]));
  if (!changed.length) return { ok: true, changed };

  const $set = Object.fromEntries(changed.map(k => [k, parsed.updates[k]]));
  try {
    await userModel.findByIdAndUpdate(id, { $set }, { runValidators: true });
  } catch (err) {
    // The unique index on email is the real guard; turn its collision into a clear message.
    if (isDuplicateEmail(err)) return { ok: false, code: 'profile_email_taken' };
    throw err;
  }
  return { ok: true, changed };
}

// Deep "did this change?" for the Mixed analysis fields (arrays / nested objects).
function sameJson(a, b) {
  return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
}

// Editable sections of a SkinAnalysis. Each one turns the JSON an editor posted into the
// exact values to $set (already sanitized), or an error code. `current` is the stored
// document (only the fields in `reads`), for sections whose output depends on it.
const SECTIONS = {
  // Customer page "Skin Era & analysis" card.
  fields: {
    action: 'analysis_fields_updated',
    reads: 'eraId skinAnalysis keyInsights affirmation',
    build(body, current) {
      const era = eraById(body.eraId);
      if (!era) return { error: 'analysis_invalid_era' };
      const set = {
        eraId: era.id,
        skinAnalysis: text(body.skinAnalysis, 5000),
        keyInsights: sanitizeKeyInsights(body.keyInsights),
        affirmation: text(body.affirmation, 300),
      };
      // The full era object is only rewritten when the era actually changes. Comparing
      // the stored object itself would flag a change whenever its key order differs.
      if (era.id !== current.eraId) set.era = era;
      return { set };
    },
  },
};

/**
 * Apply one editor's JSON to a SkinAnalysis.
 * Returns { ok: true, changed, action, userId } or { ok: false, code }.
 * `changed` lists field names whose value really differs; only those are written, in a
 * single $set. A whole-field $set also avoids Mongoose silently dropping in-place edits
 * to Mixed fields (it cannot see nested changes without markModified).
 */
async function updateAnalysisSection(id, sectionName, body, { analysisModel = SkinAnalysis } = {}) {
  const section = SECTIONS[sectionName];
  if (!section) throw new Error(`Unknown analysis section: ${sectionName}`);
  if (!mongoose.isValidObjectId(id)) return { ok: false, code: 'analysis_notfound' };

  const current = await analysisModel.findById(id).select(`userId ${section.reads}`).lean();
  if (!current) return { ok: false, code: 'analysis_notfound' };

  const built = section.build(body && typeof body === 'object' ? body : {}, current);
  if (built.error) return { ok: false, code: built.error };

  const changed = Object.keys(built.set).filter(k => !sameJson(current[k], built.set[k]));
  if (changed.length) {
    const $set = Object.fromEntries(changed.map(k => [k, built.set[k]]));
    await analysisModel.findByIdAndUpdate(id, { $set });
  }
  return { ok: true, changed, action: section.action, userId: current.userId };
}

module.exports = { parseProfileForm, updateUserProfile, updateAnalysisSection, SECTIONS };
