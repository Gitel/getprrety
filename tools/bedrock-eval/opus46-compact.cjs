'use strict';

const COMPACT_CONTRACT_VERSION = 'opus46-compact-all5-v1';

// This prompt extension applies only to the compact wire contract; canonical output
// requirements remain enforced after server-owned fields are restored.
const COMPACT_SYSTEM_INSTRUCTIONS = [
  `Compact response contract (${COMPACT_CONTRACT_VERSION}): these compact-field rules override canonical prompt field-name and numbering instructions only; preserve all canonical safety and routine semantics.`,
  'Use only the fields in the supplied compact schema. Do not return suggested_replacement, sr_product_name, sr_substitute_name, first_sr_purchase, or the numeric step field; the server restores them from validated catalogue IDs or array position.',
  'SR step order is its array position; the server supplies the numeric step. For each SR routine step, put one concise explanation in explanation. A matched ID needs its catalogue match reason. For every unmatched step, including cleanse and protect, give specific no-match guidance in explanation. Do not return match_reason or no_match_note.',
  'For all product IDs, use only exact IDs from the supplied eligible catalogue. Use null for an unmatched product ID; never invent, copy, or return an ID outside that catalogue.',
  'When the supplied eligible catalogue is empty, return srProducts as null.',
  'Generic routine category labels are restored from category_id in the requested language; do not add category labels to the compact response.',
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
  omitProperty(srStep, 'step');
  omitProperty(srStep, 'sr_product_name');
  omitProperty(srStep, 'match_reason');
  omitProperty(srStep, 'no_match_note');
  if (srStep?.type === 'object') {
    srStep.properties.explanation = { type: 'string' };
    srStep.required.push('explanation');
  }
  return schema;
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

  // Rebuild canonical generic labels from stable IDs so provider text cannot vary them.
  const labels = ROUTINE_CATEGORY_LABELS[language];
  for (const period of ['am', 'pm']) {
    for (const step of output.era.routine[period]) {
      step.category = labels[step.category_id];
    }
  }

  for (const item of output.era.product_audit.current_products_assessment) {
    const id = item.suggested_replacement_product_id;
    validateCatalogueId(id, byId);
    item.suggested_replacement = item.verdict === 'replace' && id !== null ? restoreCatalogueName(id, byId) : null;
  }

  if (output.srProducts) {
    const hero = output.srProducts.era_hero_product;
    validateCatalogueId(hero.sr_product_id, byId);
    hero.sr_product_name = restoreCatalogueName(hero.sr_product_id, byId);

    for (const period of ['am', 'pm']) {
      for (const [index, step] of output.srProducts[period].entries()) {
        validateCatalogueId(step.sr_product_id, byId);
        step.step = index + 1;
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
      validateCatalogueId(product.sr_substitute_product_id, byId);
      product.sr_substitute_name = restoreCatalogueName(product.sr_substitute_product_id, byId);
    }
    const transition = output.shelfAnalysis.transition_plan;
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
