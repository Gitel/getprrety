'use strict';

const { outputSchema, buildMessages, eligibleProducts, hasNoEvent } = require('./analysisContract');
const { makeWireSchema } = require('./wireSchema');
const { makeCompactWireSchema, hydrateCompactOutput } = require('./compact');
const { DEFAULTS, assembleSystem } = require('../aiConfig/defaults');

// Prepare the shared production/evaluation prompt and wire contract in one place.
// `guidance` is the admin-editable part of the prompt (see services/aiConfig); it defaults to the
// built-in text so callers without a DB (tools/bedrock-eval) get exactly the historical prompt.
function prepareSkinRequest({ quiz = {}, language = 'en', images = [], catalogue = [], guidance = DEFAULTS.skin_analysis.defaultGuidance } = {}) {
  const products = eligibleProducts(catalogue, quiz);
  const built = buildMessages({ quiz, language, images, catalogue });
  const baseWireSchema = makeWireSchema(outputSchema);
  // Shelf details require shelf evidence; event preparation requires an actual event answer.
  if (!images.some(image => image.angle === 'shelf')) baseWireSchema.properties.shelfAnalysis = { type: 'null' };
  if (hasNoEvent(quiz)) {
    baseWireSchema.properties.era.properties.event_prep = { type: 'null' };
  }
  const wireSchema = makeCompactWireSchema(baseWireSchema, { hasEligibleProducts: products.length > 0 });
  return {
    // Locked rules (analysisPrompt.md) + clinic guidance + compact-contract rules, in that order.
    system: assembleSystem('skin_analysis', guidance),
    messages: built.messages,
    schema: outputSchema,
    wireSchema,
    hydrateOutput: wire => hydrateCompactOutput(wire, { eligibleProducts: products, language }),
  };
}

module.exports = { prepareSkinRequest };
