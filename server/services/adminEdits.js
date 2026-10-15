// Admin edits to users and analyses. Each function validates the submitted form, writes
// with a single $set, and reports WHICH fields actually changed, so the route can audit
// field names and tell the admin "nothing changed" when that is the case.
const mongoose = require('mongoose');
const User = require('../models/User');
const SkinAnalysis = require('../models/SkinAnalysis');
const SkinScan = require('../models/SkinScan');
const { isDuplicateEmail } = require('./duplicateKey');
const {
  text,
  sanitizeKeyInsights,
  sanitizeTextList,
  sanitizeRoutine,
  sanitizeProductAudit,
  sanitizeProductRecs,
  sanitizeSrProducts,
  sanitizeShelfAnalysis,
} = require('./analysisFields');
const { eraById } = require('./eras');
// Safety logic is NOT re-implemented here: product eligibility, the quiz whitelist, the
// catalogue loader and the reading sanitizer are the same ones the AI routes use.
const { eligibleProducts, sanitizeQuiz } = require('./bedrock/analysisContract');
const { loadCatalogue } = require('./bedrock/catalogue');
const { sanitizeReading } = require('./skinScan/scoreReading');
const { scanView } = require('./skinScan/scanView');

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

  // Customer page "Routine" card: the AM/PM steps the Home screen checks off.
  routine: {
    action: 'routine_updated',
    reads: 'routine',
    build(body) {
      return { set: { routine: sanitizeRoutine(body.routine) } };
    },
  },

  // Customer page "Product audit" card: the keep / remove / replace / add buckets the
  // Profile screen shows as tabs, plus the optional product pick (brand / name / price /
  // link) on each replace and add item.
  audit: {
    // Audited as a picks-only change when the buckets themselves did not change.
    action: changed => (changed.includes('productAudit') ? 'product_audit_updated' : 'product_picks_updated'),
    reads: 'productAudit productRecs',
    // The "replace with" picker on each replace row (the name field is `to`).
    picks(body) {
      const audit = isObj(body.productAudit) ? body.productAudit : {};
      return asArray(audit.replace).filter(isObj).map(row => spot(row, 'to_product_id', 'to'));
    },
    build(body) {
      return { set: buildAuditAndPicks(body.productAudit) };
    },
  },

  // Customer page "SR Ritual" card.
  sr: {
    action: 'sr_ritual_updated',
    reads: 'srProducts',
    // Every product picker in this card: the hero product and each AM / PM step.
    picks(body) {
      const sr = isObj(body.srProducts) ? body.srProducts : {};
      const spots = [];
      if (isObj(sr.era_hero_product)) spots.push(spot(sr.era_hero_product, 'sr_product_id', 'sr_product_name'));
      [...asArray(sr.am), ...asArray(sr.pm)].forEach(step => {
        if (isObj(step)) spots.push(spot(step, 'sr_product_id', 'sr_product_name'));
      });
      return spots;
    },
    build(body) {
      return { set: { srProducts: sanitizeSrProducts(body.srProducts) } };
    },
  },

  // Customer page "Current shelf" card.
  shelf: {
    action: 'shelf_updated',
    reads: 'shelfAnalysis',
    // The "swap with" picker on each identified product + the "start here" first purchase.
    picks(body) {
      const shelf = isObj(body.shelfAnalysis) ? body.shelfAnalysis : {};
      const spots = asArray(shelf.identified_products).filter(isObj)
        .map(p => spot(p, 'sr_substitute_product_id', 'sr_substitute_name'));
      if (isObj(shelf.transition_plan)) {
        spots.push(spot(shelf.transition_plan, 'first_sr_purchase_product_id', 'first_sr_purchase'));
      }
      return spots;
    },
    build(body) {
      return { set: { shelfAnalysis: sanitizeShelfAnalysis(body.shelfAnalysis) } };
    },
  },

  // Customer page "Safety" card: safety flags and check-in prompts, one per line.
  safety: {
    action: 'safety_updated',
    reads: 'safetyFlags checkInPrompts',
    build(body, current) {
      const set = {};
      // A list that is empty now AND was never stored is skipped, so saving an untouched
      // form for an old analysis (field missing / null) is not reported as a change.
      [['safetyFlags', sanitizeTextList(body.safetyFlags)], ['checkInPrompts', sanitizeTextList(body.checkInPrompts)]]
        .forEach(([key, value]) => { if (value.length || current[key] != null) set[key] = value; });
      return { set };
    },
  },

  // Customer page "Score reading" card. Unlike the others this edits the linked SkinScan,
  // not the analysis, so it runs its own write (see updateReading below).
  reading: {
    action: 'score_reading_updated',
    reads: 'skinScanId',
    run: (body, current, deps) => updateReading(body, current, deps),
  },
};

// ---- Product picker support (contract section 5) ---------------------------------------

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const isObj = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const asArray = v => (Array.isArray(v) ? v : []);
// One product picker inside the posted JSON: `obj[idKey]` is the picker value and
// `obj[nameKey]` the display name the server writes next to it.
const spot = (obj, idKey, nameKey) => ({ obj, idKey, nameKey });

// Every *product_id string already stored on the analysis. A picker value that is already
// stored is an UNCHANGED pick and is not re-checked against today's eligibility.
function storedProductIds(current) {
  const ids = new Set();
  (function walk(v, key) {
    if (typeof v === 'string' && /product_id$/.test(key || '')) ids.add(v);
    else if (Array.isArray(v)) v.forEach(x => walk(x, key));
    else if (isObj(v)) Object.keys(v).forEach(k => { if (k !== 'quizAnswers') walk(v[k], k); });
  })(current);
  return ids;
}

/**
 * Resolve every product picker value in the posted body (mutates the body):
 *  - ''                -> "No product": id and name are cleared.
 *  - 'keep:<legacyId>' -> a legacy value (free text / old id) that is not in the picker list:
 *                         kept as posted. A 'keep:' of a real catalogue id must already be stored.
 *  - '<24-hex id>'     -> a catalogue pick. NEW picks must be an active home-use product that is
 *                         eligible for this customer's quiz (allergy / pregnancy rules);
 *                         the name is then filled from the catalogue.
 * Returns an error code or null. A pick field that was not posted is left untouched.
 */
async function resolvePicks(spots, current, { catalogueLoader }) {
  const stored = storedProductIds(current);
  let catalogue = null; // loaded lazily: sections without picks never hit the DB
  let eligible = null;
  for (const { obj, idKey, nameKey } of spots) {
    const raw = obj[idKey];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value === '') { obj[idKey] = ''; obj[nameKey] = ''; continue; }
    if (value.startsWith('keep:')) {
      const legacyId = value.slice(5);
      if (OBJECT_ID_RE.test(legacyId) && !stored.has(legacyId)) return 'analysis_product_unknown';
      obj[idKey] = legacyId;
      continue;
    }
    if (!OBJECT_ID_RE.test(value)) return 'analysis_product_unknown';
    if (!catalogue) {
      catalogue = await catalogueLoader(); // active, home-use products only
      let quiz = {};
      try { quiz = sanitizeQuiz(current.quizAnswers || {}); } catch { /* unusable quiz = nothing eligible */ }
      eligible = new Set(eligibleProducts(catalogue, quiz).map(p => String(p._id)));
    }
    const product = catalogue.find(p => String(p._id) === value);
    if (!product) {
      // Archived / non-home products are gone from the list; an unchanged stored pick of
      // one keeps its posted name, anything else is unknown.
      if (stored.has(value)) continue;
      return 'analysis_product_unknown';
    }
    if (!stored.has(value) && !eligible.has(value)) return 'analysis_product_ineligible';
    obj[idKey] = value;
    obj[nameKey] = product.name;
  }
  return null;
}

// ---- Score reading ----------------------------------------------------------------------

const READING_TEXT_FIELDS = ['why', 'driver', 'lever'];

/**
 * Merge the admin's edited text into the stored SkinScan.reading and save it whole.
 * Only startHere.title/body and each signal's why/driver/lever are editable; potential,
 * weeks, shelf and product are copied from the stored reading. The merged result is run
 * through the same sanitizeReading the AI output goes through. Because that sanitizer cuts
 * over-long text silently, we compare afterwards and REJECT anything it had to cut.
 */
async function updateReading(body, current, { scanModel }) {
  const none = { ok: false, code: 'analysis_no_reading' };
  if (!current.skinScanId) return none;
  const scan = await scanModel.findById(current.skinScanId).select('userId merged reading').lean();
  // A scan that belongs to someone else must never be edited through this customer's page.
  if (!scan || !scan.reading || String(scan.userId) !== String(current.userId)) return none;

  const stored = scan.reading;
  const posted = isObj(body.startHere) ? body.startHere : {};
  const postedSignals = new Map(asArray(body.signals).filter(isObj).map(s => [s.key, s]));
  const str = (v, fallback) => (typeof v === 'string' ? v.trim() : fallback);
  const storedStart = stored.startHere || {};

  // Build the model-shaped JSON sanitizeReading expects (start_here + full signal entries).
  const input = {
    start_here: { title: str(posted.title, storedStart.title), body: str(posted.body, storedStart.body) },
    signals: asArray(stored.signals).map(sig => {
      const edit = postedSignals.get(sig.key) || {};
      const merged = { ...sig };
      READING_TEXT_FIELDS.forEach(f => { merged[f] = str(edit[f], sig[f]); });
      return merged;
    }),
  };
  const signals = (scanView(scan).signals || {}).signals || [];
  const clean = sanitizeReading(input, signals);
  if (!clean) return { ok: false, code: 'analysis_invalid_reading' };

  // Reject (not truncate) over-long text: the sanitized value must equal what was typed.
  const typedStart = input.start_here;
  if ((typedStart.title || typedStart.body)
    && (!clean.startHere || clean.startHere.title !== typedStart.title || clean.startHere.body !== typedStart.body)) {
    return { ok: false, code: 'analysis_invalid_reading' };
  }
  const cleanByKey = new Map(clean.signals.map(s => [s.key, s]));
  for (const sig of input.signals) {
    const out = cleanByKey.get(sig.key);
    if (READING_TEXT_FIELDS.some(f => sig[f] && (!out || out[f] !== sig[f]))) {
      return { ok: false, code: 'analysis_invalid_reading' };
    }
  }

  // Non-editable fields always come from the stored reading (sanitizeReading would null a
  // "potential" below today's score, and the admin must not be able to change any of them).
  const storedByKey = new Map(asArray(stored.signals).map(s => [s.key, s]));
  const reading = {
    startHere: clean.startHere,
    signals: clean.signals.map(s => {
      const old = storedByKey.get(s.key) || {};
      return { ...s, potential: old.potential ?? null, weeks: old.weeks ?? null, shelf: old.shelf ?? null, product: old.product ?? null };
    }),
  };

  // Field NAMES that really changed (for the audit log; text is never logged).
  const changed = [];
  ['title', 'body'].forEach(f => {
    if (!same(storedStart[f], (reading.startHere || {})[f])) changed.push(`startHere.${f}`);
  });
  asArray(stored.signals).forEach(sig => {
    const out = cleanByKey.get(sig.key) || {};
    READING_TEXT_FIELDS.forEach(f => { if (!same(sig[f], out[f])) changed.push(`${sig.key}.${f}`); });
  });
  if (changed.length) await scanModel.findByIdAndUpdate(scan._id, { $set: { reading } });
  return { ok: true, changed, action: SECTIONS.reading.action, userId: current.userId };
}

/**
 * Split the audit editor's rows into { productAudit, productRecs }.
 *
 * In the editor each replace/add row carries its own `pick`, so an item and its pick
 * always move together. The app, however, stores picks separately and finds them by
 * POSITION ({ index: i } -> productAudit[bucket][i]). The pairing is therefore done here,
 * AFTER empty rows are dropped, so every index points at the item it was typed next to.
 *
 * productRecs is null when no pick has any content: that hands picks back to the AI
 * (the Profile screen asks Claude whenever productRecs is null).
 */
function buildAuditAndPicks(rawAudit) {
  const src = rawAudit && typeof rawAudit === 'object' ? rawAudit : {};
  const productAudit = { keep: [], remove: [], replace: [], add: [] };
  const rawRecs = { add: [], replace: [] };

  Object.keys(productAudit).forEach(bucket => {
    (Array.isArray(src[bucket]) ? src[bucket] : []).forEach(row => {
      // Sanitize one row at a time so we know whether it survived, and at which index.
      const [item] = sanitizeProductAudit({ [bucket]: [row] })[bucket];
      if (!item) return;
      productAudit[bucket].push(item);
      if ((bucket === 'add' || bucket === 'replace') && row && typeof row.pick === 'object') {
        rawRecs[bucket].push({ index: productAudit[bucket].length - 1, rec: row.pick });
      }
    });
    // The same caps sanitizeProductAudit applies to a whole bucket.
    productAudit[bucket] = sanitizeProductAudit({ [bucket]: productAudit[bucket] })[bucket];
  });

  const recs = sanitizeProductRecs(rawRecs, productAudit);
  const productRecs = recs.add.length || recs.replace.length ? recs : null;
  return { productAudit, productRecs };
}

/**
 * Apply one editor's JSON to a SkinAnalysis.
 * Returns { ok: true, changed, action, userId } or { ok: false, code }.
 * `changed` lists field names whose value really differs; only those are written, in a
 * single $set. A whole-field $set also avoids Mongoose silently dropping in-place edits
 * to Mixed fields (it cannot see nested changes without markModified).
 */
async function updateAnalysisSection(id, sectionName, body, {
  analysisModel = SkinAnalysis, scanModel = SkinScan, catalogueLoader = loadCatalogue,
} = {}) {
  const section = SECTIONS[sectionName];
  if (!section) throw new Error(`Unknown analysis section: ${sectionName}`);
  if (!mongoose.isValidObjectId(id)) return { ok: false, code: 'analysis_notfound' };

  // quizAnswers is only needed to judge product eligibility for the picker sections.
  const extra = section.picks ? ' quizAnswers' : '';
  const current = await analysisModel.findById(id).select(`userId ${section.reads}${extra}`).lean();
  if (!current) return { ok: false, code: 'analysis_notfound' };

  const input = body && typeof body === 'object' ? body : {};
  // The reading section edits the linked SkinScan and does its own write.
  if (section.run) return section.run(input, current, { scanModel });
  // Picker sections: validate each picked product and fill its name from the catalogue first.
  if (section.picks) {
    const code = await resolvePicks(section.picks(input), current, { catalogueLoader });
    if (code) return { ok: false, code };
  }

  const built = section.build(input, current);
  if (built.error) return { ok: false, code: built.error };

  const changed = Object.keys(built.set).filter(k => !sameJson(current[k], built.set[k]));
  if (changed.length) {
    const $set = Object.fromEntries(changed.map(k => [k, built.set[k]]));
    // Picks carry an "edited at" stamp, written only when the picks really changed
    // (and cleared when they were handed back to the AI).
    if (changed.includes('productRecs')) $set.productRecsEditedAt = built.set.productRecs ? new Date() : null;
    await analysisModel.findByIdAndUpdate(id, { $set });
  }
  const action = typeof section.action === 'function' ? section.action(changed) : section.action;
  return { ok: true, changed, action, userId: current.userId };
}

module.exports = { parseProfileForm, updateUserProfile, updateAnalysisSection, SECTIONS };
