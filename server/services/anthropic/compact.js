'use strict';

const COMPACT_CONTRACT_VERSION = 'anthropic-compact-v3';

// This prompt extension applies only to the compact wire contract; canonical output
// requirements remain enforced after server-owned fields are restored.
const COMPACT_SYSTEM_INSTRUCTIONS = [
  `Compact response contract (${COMPACT_CONTRACT_VERSION}): these compact-field rules override canonical prompt field-name and numbering instructions only; preserve all canonical safety and routine semantics.`,
  'Use only the fields in the supplied compact schema. Do not return suggested_replacement, sr_product_name, sr_substitute_name, first_sr_purchase, or the numeric step field; the server restores them from validated catalogue IDs or array position.',
  'SR step order is its array position; the server supplies the numeric step. For each SR routine step, put one concise explanation in explanation. A matched ID needs its catalogue match reason. For every unmatched step, including cleanse and protect, give specific no-match guidance in explanation. Do not return match_reason or no_match_note.',
  'For all product IDs, use only exact IDs from the supplied eligible catalogue. Use an empty string for an unmatched product ID; never invent, copy, or return an ID outside that catalogue. Use an empty string for most_urgent_gap when there is no missing need. The server restores these empty values to canonical null.',
  'For srProducts, shelfAnalysis and event_prep, return null only when the supplied schema requires null. Otherwise return the full section object. To represent an absent section, fill every required string with an empty string and every array with an empty array, including nested objects; the server restores only a wholly empty section to null. Keep all useful explanations and uncertainty notes. Never invent content to fill an absent section.',
  'When the supplied eligible catalogue is empty, return srProducts as null.',
  'Generic category and SR routine_category labels are restored from category_id in the requested language; do not add either display label to the compact response.',
].join('\n');

// Keep fixed labels aligned with the EN/HE routine labels used by opus46-compact.test.cjs.
const ROUTINE_CATEGORY_LABELS = Object.freeze({
  en: Object.freeze({ cleanse: 'Cleanse', treat: 'Treatment', moisturize: 'Moisturize', protect: 'Protect', other: 'Other' }),
  he: Object.freeze({ cleanse: 'ניקוי', treat: 'טיפול', moisturize: 'לחות', protect: 'הגנה', other: 'אחר' }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function removeRequired(required, key) {
  const index = required.indexOf(key);
  if (index >= 0) required.splice(index, 1);
}

function omitProperty(schema, key) {
  const isObject = schema?.type === 'object' || (Array.isArray(schema?.type) && schema.type.includes('object'));
  if (!isObject || !schema.properties?.[key]) return;
  delete schema.properties[key];
  removeRequired(schema.required || [], key);
}

// Nullable branches multiply the provider's compiled grammar, especially inside
// these nested sections. Keep the same fields and enums, but let empty strings
// and wholly empty section objects represent absence on the provider wire only.
function simplifyNullableTypes(schema) {
  if (!schema || typeof schema !== 'object') return;
  if (Array.isArray(schema.type) && schema.type.length === 2 && schema.type.includes('null')) {
    schema.type = schema.type.find(type => type !== 'null');
  }
  for (const value of Object.values(schema)) simplifyNullableTypes(value);
}

// Build a compact provider schema while leaving the canonical schema untouched.
function makeCompactWireSchema(baseWireSchema, { hasEligibleProducts = true } = {}) {
  const schema = clone(baseWireSchema);
  // A generic routine's category_id is enough to restore its fixed localized label.
  const genericRoutineStep = schema.$defs?.routineStep;
  omitProperty(genericRoutineStep, 'category');

  // With no eligible catalogue items, no SR product recommendation can be valid.
  if (!hasEligibleProducts) {
    schema.properties.srProducts = { type: 'null' };
    delete schema.$defs?.srStep;
  }

  const assessmentItem = schema.properties?.era?.properties?.product_audit?.properties
    ?.current_products_assessment?.items;
  omitProperty(assessmentItem, 'suggested_replacement');

  const hero = schema.properties?.srProducts?.properties?.era_hero_product;
  omitProperty(hero, 'sr_product_name');

  const shelf = schema.properties?.shelfAnalysis;
  const identifiedItem = shelf?.properties?.identified_products?.items;
  omitProperty(identifiedItem, 'sr_substitute_name');
  omitProperty(shelf?.properties?.transition_plan, 'first_sr_purchase');

  const srStep = schema.$defs?.srStep;
  // SR labels duplicate the generic routine category. Restore both from the same localized ID
  // instead of adding another free-text field to each compiled SR step object.
  omitProperty(srStep, 'routine_category');
  omitProperty(srStep, 'step');
  omitProperty(srStep, 'sr_product_name');
  omitProperty(srStep, 'match_reason');
  omitProperty(srStep, 'no_match_note');
  if (srStep?.type === 'object') {
    srStep.properties.explanation = { type: 'string' };
    srStep.required.push('explanation');
  }
  simplifyNullableTypes(schema);
  return schema;
}

// Only a wholly empty section means "absent". A nonempty array or even one
// uncertainty note is real content and must survive for canonical validation.
function isEmptySection(value) {
  if (value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return Boolean(value && typeof value === 'object' && Object.values(value).every(isEmptySection));
}

function makeEligibleProductMap(eligibleProducts = []) {
  const byId = new Map();
  for (const product of eligibleProducts) {
    if (typeof product?._id === 'string' && product._id && typeof product.name === 'string') {
      byId.set(product._id, product.name);
    }
  }
  return byId;
}

function restoreCatalogueName(id, byId) {
  if (id === null) return '';
  if (typeof id !== 'string' || !id || !byId.has(id)) {
    // Do not echo a model-supplied ID in error messages or report metadata.
    throw new Error('compact_response_invalid_catalogue_id');
  }
  return byId.get(id);
}

function validateCatalogueId(id, byId) {
  if (id === null) return;
  if (typeof id !== 'string' || !id || !byId.has(id)) {
    // Reject empty and unknown IDs before adding any server-owned catalogue names.
    throw new Error('compact_response_invalid_catalogue_id');
  }
}

// Rehydrate only server-owned canonical fields after the compact response passes wire Ajv.
function hydrateCompactOutput(wireOutput, { eligibleProducts = [], language = 'en' } = {}) {
  const output = clone(wireOutput);
  const byId = makeEligibleProductMap(eligibleProducts);

  for (const key of ['srProducts', 'shelfAnalysis']) {
    if (isEmptySection(output[key])) output[key] = null;
  }
  if (isEmptySection(output.era.event_prep)) output.era.event_prep = null;
  if (output.era.product_audit.most_urgent_gap === '') output.era.product_audit.most_urgent_gap = null;

  // Rebuild canonical generic labels from stable IDs so provider text cannot vary them.
  const labels = ROUTINE_CATEGORY_LABELS[language];
  for (const period of ['am', 'pm']) {
    for (const step of output.era.routine[period]) {
      step.category = labels[step.category_id];
    }
  }

  for (const item of output.era.product_audit.current_products_assessment) {
    if (item.suggested_replacement_product_id === '') item.suggested_replacement_product_id = null;
    const id = item.suggested_replacement_product_id;
    validateCatalogueId(id, byId);
    item.suggested_replacement = item.verdict === 'replace' && id !== null ? restoreCatalogueName(id, byId) : null;
  }

  if (output.srProducts) {
    const hero = output.srProducts.era_hero_product;
    if (hero.sr_product_id === '') hero.sr_product_id = null;
    validateCatalogueId(hero.sr_product_id, byId);
    hero.sr_product_name = restoreCatalogueName(hero.sr_product_id, byId);

    for (const period of ['am', 'pm']) {
      for (const [index, step] of output.srProducts[period].entries()) {
        if (step.sr_product_id === '') step.sr_product_id = null;
        validateCatalogueId(step.sr_product_id, byId);
        step.step = index + 1;
        step.routine_category = labels[step.category_id];
        step.sr_product_name = restoreCatalogueName(step.sr_product_id, byId);
        // ID presence distinguishes a match rationale from an unmatched-step note.
        step.match_reason = step.sr_product_id === null ? '' : step.explanation;
        step.no_match_note = step.sr_product_id === null ? step.explanation : '';
        delete step.explanation;
      }
    }
  }

  if (output.shelfAnalysis) {
    for (const product of output.shelfAnalysis.identified_products) {
      if (product.sr_substitute_product_id === '') product.sr_substitute_product_id = null;
      validateCatalogueId(product.sr_substitute_product_id, byId);
      product.sr_substitute_name = restoreCatalogueName(product.sr_substitute_product_id, byId);
    }
    const transition = output.shelfAnalysis.transition_plan;
    if (transition.first_sr_purchase_product_id === '') transition.first_sr_purchase_product_id = null;
    validateCatalogueId(transition.first_sr_purchase_product_id, byId);
    transition.first_sr_purchase = restoreCatalogueName(transition.first_sr_purchase_product_id, byId);
  }

  return output;
}

module.exports = {
  COMPACT_CONTRACT_VERSION,
  COMPACT_SYSTEM_INSTRUCTIONS,
  makeCompactWireSchema,
  hydrateCompactOutput,
};
