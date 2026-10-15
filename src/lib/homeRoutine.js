// Pure helpers behind the Home routine dashboard (HomeScreen.jsx). Kept out of the
// component so the rules can be unit-tested.

// The steps Home shows for one tab ('am' | 'pm'), as { name, description, category? }.
// The product-matched routine replaces generic steps when available; unmatched steps
// reconnect by category_id to preserve guidance from the shared server analysis contract.
// A catalogue product id is a 24-char hex Mongo ObjectId; anything else (null,
// 'admin-entered', old ids like 'sr-clean') is not a real catalogue product.
const PRODUCT_ID = /^[a-f0-9]{24}$/;
const asProductId = id => (typeof id === 'string' && PRODUCT_ID.test(id) ? id : null);

export function routineSteps(analysis, tab) {
  const productSteps = analysis?.srProducts?.[tab];
  if (Array.isArray(productSteps) && productSteps.length > 0) {
    const genericByCategory = new Map((analysis?.routine?.[tab] || []).map(step => [step.category_id, step]));
    return productSteps.map(step => (step.sr_product_id
      // Matched product: show the product, with its routine slot as a caption.
      ? { name: step.sr_product_name, description: step.use_instruction, category: step.routine_category, productId: asProductId(step.sr_product_id) }
      // Unmatched steps remain visible and keep their generic safety instruction, including SPF.
      : {
        name: step.routine_category,
        productId: null,
        // Catalogue notes can be generic (“no match”); retain the specific SPF direction after reload.
        description: step.category_id === 'protect'
          ? genericByCategory.get(step.category_id)?.description || step.no_match_note || 'Source externally for this step.'
          : step.no_match_note || genericByCategory.get(step.category_id)?.description || 'Source externally for this step.',
      }));
  }
  return analysis?.routine?.[tab] || [];
}

// Which tab Home opens on, from the onboarding answer (user.skincareTiming).
// 'both' or never answered -> whichever routine is next: morning before noon.
export function defaultRoutineTab(skincareTiming, hour) {
  if (skincareTiming === 'morning') return 'am';
  if (skincareTiming === 'night') return 'pm';
  return hour < 12 ? 'am' : 'pm';
}

// The user's local calendar day as 'YYYY-MM-DD' (step ticks are stored per local day).
export function localDay(date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

// Short signature of the routine on screen, saved with the day's ticks. Ticks are step
// indices, so if the routine changes (e.g. a retake mid-day) the signature changes and
// the old ticks are ignored instead of landing on the wrong steps.
// FNV-1a 32-bit hash of the step names: tiny, deterministic, collision risk irrelevant here.
export function routineKeyFor(amSteps, pmSteps) {
  const text = JSON.stringify([amSteps.map(s => s?.name ?? ''), pmSteps.map(s => s?.name ?? '')]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

// Turns Home's tick state ({ am0: true, pm2: true, ... }) into the lists the server stores.
export function tickedIndices(done, tab) {
  return Object.keys(done)
    .filter(key => key.startsWith(tab) && done[key])
    .map(key => Number(key.slice(tab.length)))
    .sort((a, b) => a - b);
}
