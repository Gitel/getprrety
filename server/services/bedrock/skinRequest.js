'use strict';

const { outputSchema, buildMessages, eligibleProducts, hasNoEvent } = require('./analysisContract');
const { makeWireSchema } = require('./wireSchema');
const { makeCompactWireSchema, COMPACT_SYSTEM_INSTRUCTIONS, hydrateCompactOutput } = require('./compact');

// Prepare the shared production/evaluation prompt and wire contract in one place.
function prepareSkinRequest({ quiz = {}, language = 'en', images = [], catalogue = [] } = {}) {
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
    system: `${built.system}\n\n${COMPACT_SYSTEM_INSTRUCTIONS}`,
    messages: built.messages,
    schema: outputSchema,
    wireSchema,
    hydrateOutput: wire => hydrateCompactOutput(wire, { eligibleProducts: products, language }),
  };
}

module.exports = { prepareSkinRequest };
