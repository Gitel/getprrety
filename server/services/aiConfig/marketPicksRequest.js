'use strict';

// Request building for the "market picks" (other-brand product recommendations) AI task.
// Shared by routes/ai.js (production) and aiConfig/testRun.js (admin test run) so both send
// exactly the same prompt and JSON schema.

const { buildSystem } = require('./aiConfig');

// One recommendation slot: which need it answers (index) and the product suggested for it.
function recommendationItemSchema(maxLength) {
  return {
    type: 'object', additionalProperties: false, required: ['index', 'rec'],
    properties: {
      index: { type: 'integer', minimum: 0, maximum: Math.max(0, maxLength - 1) },
      rec: { type: 'object', additionalProperties: false, required: ['brand', 'name', 'price', 'url', 'retailer'], properties: {
        brand: { type: 'string' }, name: { type: 'string' }, price: { type: 'string' }, url: { type: 'string' }, retailer: { type: 'string' },
      } },
    },
  };
}

// add / replace: the (already length-limited) audit items. safetyContext: allergies, irritants,
// pregnancy caution. guidance: the editable part of the system prompt.
// Returns the completeJson arguments (without the limits, which the caller adds).
function buildMarketPicksRequest({ add, replace, country, eraName, safetyContext, guidance }) {
  const safeCountry = String(country).slice(0, 100);
  const safeEra = String(eraName).slice(0, 100);
  const needs = [
    ...add.map((item, index) => `[add_${index}] [ADD] ${String(item.product || '').slice(0, 200)}`),
    ...replace.map((item, index) =>
      `[replace_${index}] [REPLACE] ${String(item.from || '').slice(0, 120)} with ${String(item.to || '').slice(0, 200)}`
    ),
  ].join('\n');
  const schema = {
    type: 'object', additionalProperties: false, required: ['add', 'replace'],
    properties: {
      add: { type: 'array', maxItems: add.length, items: recommendationItemSchema(add.length) },
      replace: { type: 'array', maxItems: replace.length, items: recommendationItemSchema(replace.length) },
    },
  };
  return {
    system: buildSystem('market_picks', guidance),
    messages: [{ role: 'user', content: `Country: ${safeCountry}\nSkin Era: ${safeEra}\nSafety context: ${JSON.stringify(safetyContext)}\nNeeds:\n${needs}` }],
    schema,
    schemaName: 'product_recommendations',
  };
}

module.exports = { buildMarketPicksRequest, recommendationItemSchema };
