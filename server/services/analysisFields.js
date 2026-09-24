// Sanitizers for every editable part of a SkinAnalysis.
//
// Used by the admin editors AND by POST /api/analysis (srProducts / shelfAnalysis), so
// there is exactly one definition of "a valid routine", "a valid product audit" and so on.
// Every sanitizer:
//  - accepts anything (malformed input never throws),
//  - keeps only the fields the app actually renders (shapes from ProfileScreen.jsx and
//    HomeScreen.jsx), so unknown keys - including __proto__ / constructor - are dropped,
//  - trims and length-caps every string and caps every list, so one edit cannot bloat a
//    document or break the app's layout,
//  - drops rows that are entirely empty (an admin clicking "add row" then saving).
const { cleanRecommendationList } = require('../routes/ai');

const MAX_STEPS = 15;          // per AM / PM list
const MAX_AUDIT_ITEMS = 20;    // per audit bucket
const MAX_INSIGHTS = 20;
const MAX_SHELF_PRODUCTS = 30;
const MAX_ACTIVES = 10;

// A trimmed, length-capped string. Numbers are accepted (form fields sometimes arrive as
// numbers from JSON); anything else becomes ''.
function text(value, max) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Map a list through `fn`, dropping nulls, capped at `max` items. Non-arrays become [].
function list(value, max, fn) {
  if (!Array.isArray(value)) return [];
  return value.map(fn).filter(Boolean).slice(0, max);
}

// Home screen routine: { am: [{ name, description }], pm: [...] }.
function sanitizeRoutine(value) {
  const src = isObject(value) ? value : {};
  const step = s => {
    if (!isObject(s)) return null;
    const out = { name: text(s.name, 120), description: text(s.description, 1000) };
    return out.name || out.description ? out : null;
  };
  return { am: list(src.am, MAX_STEPS, step), pm: list(src.pm, MAX_STEPS, step) };
}

// Profile screen product audit. Shapes per bucket:
//   keep / remove: { product, reason }
//   replace:       { from, to, reason }
//   add:           { product, reason, priority: 'essential' | 'recommended' }
function sanitizeProductAudit(value) {
  const src = isObject(value) ? value : {};
  const simple = i => {
    if (!isObject(i)) return null;
    const out = { product: text(i.product, 200), reason: text(i.reason, 500) };
    return out.product ? out : null;
  };
  const replace = i => {
    if (!isObject(i)) return null;
    const out = { from: text(i.from, 200), to: text(i.to, 200), reason: text(i.reason, 500) };
    return out.from ? out : null;
  };
  const add = i => {
    if (!isObject(i)) return null;
    const out = {
      product: text(i.product, 200),
      reason: text(i.reason, 500),
      // The app styles 'essential' red and everything else gold; keep it to the two values.
      priority: i.priority === 'essential' ? 'essential' : 'recommended',
    };
    return out.product ? out : null;
  };
  return {
    keep: list(src.keep, MAX_AUDIT_ITEMS, simple),
    remove: list(src.remove, MAX_AUDIT_ITEMS, simple),
    replace: list(src.replace, MAX_AUDIT_ITEMS, replace),
    add: list(src.add, MAX_AUDIT_ITEMS, add),
  };
}

// Specific product picks: { add: [{ index, rec }], replace: [{ index, rec }] } where
// `index` points at productAudit.add[index] / productAudit.replace[index]. Reuses the
// exact cleaner the Claude recommendations route uses (https-only links), bounded by the
// audit it belongs to so a pick can never point past the end of its bucket.
// Picks whose card would be completely blank are dropped.
function sanitizeProductRecs(value, productAudit) {
  const src = isObject(value) ? value : {};
  const audit = isObject(productAudit) ? productAudit : {};
  const notBlank = p => p.rec.brand || p.rec.name || p.rec.price || p.rec.retailer || p.rec.url;
  return {
    add: cleanRecommendationList(src.add, (audit.add || []).length).filter(notBlank),
    replace: cleanRecommendationList(src.replace, (audit.replace || []).length).filter(notBlank),
  };
}

function sanitizeKeyInsights(value) {
  return list(value, MAX_INSIGHTS, i => text(i, 500) || null);
}

// SR Ritual (Profile screen). Returns null when there is nothing to show, which the app
// treats as "no SR Ritual section".
function sanitizeSrProducts(value) {
  if (!isObject(value)) return null;
  const hero = isObject(value.era_hero_product) ? value.era_hero_product : {};
  const step = (s, i) => {
    if (!isObject(s)) return null;
    const name = text(s.sr_product_name, 200);
    const out = {
      // Displayed as the step number; always renumbered by position so it stays 1, 2, 3...
      step: i + 1,
      routine_category: text(s.routine_category, 120),
      // The app shows the product block only when sr_product_id is set, and falls back
      // to no_match_note otherwise. Admins type a product name, not a catalogue id, so a
      // name without an id gets a marker id; without it the name would silently not show.
      sr_product_id: text(s.sr_product_id, 100) || (name ? 'admin-entered' : ''),
      sr_product_name: name,
      // The app calls .replace() on each entry, so every one must be a string.
      key_actives_matched: list(s.key_actives_matched, MAX_ACTIVES, a => text(a, 60) || null),
      use_instruction: text(s.use_instruction, 1000),
      match_reason: text(s.match_reason, 1000),
      no_match_note: text(s.no_match_note, 1000),
    };
    return out.routine_category || out.sr_product_name || out.no_match_note ? out : null;
  };
  // Renumber after dropping empty rows, so the visible numbers have no gaps.
  const steps = raw => list(raw, MAX_STEPS, step).map((s, i) => ({ ...s, step: i + 1 }));

  const out = {
    bundle_note: text(value.bundle_note, 1000),
    era_hero_product: {
      sr_product_name: text(hero.sr_product_name, 200),
      hero_reason: text(hero.hero_reason, 1000),
    },
    am: steps(value.am),
    pm: steps(value.pm),
  };
  const empty = !out.bundle_note && !out.era_hero_product.sr_product_name && !out.am.length && !out.pm.length;
  return empty ? null : out;
}

// Shelf status values the app colors; anything else renders grey.
const SHELF_STATUSES = ['compatible', 'borderline', 'conflicting', 'unknown'];

// "Your Current Shelf" (Profile screen). Returns null when there are no products, which
// the app treats as "no shelf section".
function sanitizeShelfAnalysis(value) {
  if (!isObject(value)) return null;
  const summary = isObject(value.shelf_summary) ? value.shelf_summary : {};
  const plan = isObject(value.transition_plan) ? value.transition_plan : {};
  const product = p => {
    if (!isObject(p)) return null;
    const status = text(p.status, 30).toLowerCase();
    const out = {
      status: SHELF_STATUSES.includes(status) ? status : 'unknown',
      brand: text(p.brand, 100),
      product_name: text(p.product_name, 200),
      category: text(p.category, 100),
      status_reason: text(p.status_reason, 1000),
      use_instruction: text(p.use_instruction, 1000),
      sr_substitute_name: text(p.sr_substitute_name, 200),
    };
    return out.brand || out.product_name || out.category ? out : null;
  };
  const products = list(value.identified_products, MAX_SHELF_PRODUCTS, product);
  if (!products.length) return null;
  return {
    identified_products: products,
    shelf_summary: { overall_note: text(summary.overall_note, 1000) },
    transition_plan: { first_sr_purchase: text(plan.first_sr_purchase, 200) },
  };
}

module.exports = {
  text,
  sanitizeRoutine,
  sanitizeProductAudit,
  sanitizeProductRecs,
  sanitizeKeyInsights,
  sanitizeSrProducts,
  sanitizeShelfAnalysis,
  SHELF_STATUSES,
  LIMITS: { MAX_STEPS, MAX_AUDIT_ITEMS, MAX_INSIGHTS, MAX_SHELF_PRODUCTS, MAX_ACTIVES },
};
