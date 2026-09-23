// Pure helpers behind the Home routine dashboard (HomeScreen.jsx). Kept out of the
// component so the rules can be unit-tested.

// The steps Home shows for one tab ('am' | 'pm'), as { name, description, category? }.
// The product-matched routine (srProducts, from Railway) replaces the generic Gemini
// steps whenever it has steps for that tab (owner decision); otherwise the generic
// routine is used, which is also all a fallback result has.
// The srProducts step shape is the one ProfileScreen already reads; it is owned by the
// Railway service and must be re-confirmed once that service is back.
export function routineSteps(analysis, tab) {
  const productSteps = analysis?.srProducts?.[tab];
  if (Array.isArray(productSteps) && productSteps.length > 0) {
    return productSteps.map(step => (step.sr_product_id
      // Matched product: show the product, with its routine slot as a caption.
      ? { name: step.sr_product_name, description: step.use_instruction, category: step.routine_category }
      // No product matched this slot: show the slot and Railway's note.
      : { name: step.routine_category, description: step.no_match_note || 'Source externally for this step.' }));
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
