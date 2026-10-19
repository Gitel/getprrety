'use strict';

// Admin "Test" button: ONE real provider call with the (unsaved) form values on a built-in
// synthetic sample case. It goes through the same request builders as production
// (prepareSkinRequest, prepareReadingCall, buildMarketPicksRequest), validates the answer the
// same way, and saves nothing. The caller (routes/adminAi.js) rate-limits it.

const anthropic = require('../anthropic/client');
const { loadCatalogue } = require('../anthropic/catalogue');
const { prepareSkinRequest } = require('../anthropic/skinRequest');
const { validateOutput } = require('../anthropic/analysisContract');
const { prepareReadingCall, finishReading } = require('../skinScan/scoreReading');
const { buildMarketPicksRequest } = require('./marketPicksRequest');

// Small, display-only digest of a skin analysis (the admin page shows it as JSON).
function skinSummary(output) {
  const era = output.era || {};
  return {
    summary: era.skin_analysis?.summary || '',
    era: era.era?.id || null,
    amSteps: era.routine?.am?.length || 0,
    pmSteps: era.routine?.pm?.length || 0,
    srProductsReturned: Boolean(output.srProducts),
    safetyFlags: era.safety_flags || [],
  };
}

// key: skin_analysis | score_reading | market_picks. sampleCase: an entry of sampleCases.js.
// settings: { guidance, limits: { timeoutSec, maxOutputTokens, maxCostUsd } } = the form values.
// deps: injectable for unit tests (defaults are the real provider client and catalogue loader).
// Returns { ok, durationMs, costUsd, validationErrors, summary } or { ok: false, code, ... }.
async function runTestCase(key, sampleCase, settings, deps = {}) {
  const isConfigured = deps.isConfigured || anthropic.isConfigured;
  const complete = deps.completeJson || anthropic.completeJson;
  const loadCatalogueImpl = deps.loadCatalogue || loadCatalogue;
  // No provider token: do not call anything (the admin page shows "AI is not configured").
  if (!await isConfigured()) return { ok: false, code: 'ANTHROPIC_NOT_CONFIGURED' };

  const { guidance, limits } = settings;
  const startedAt = Date.now();
  let costUsd = null;
  // The provider client reports the priced usage through this telemetry event.
  const limitArgs = {
    maxOutputTokens: limits.maxOutputTokens,
    timeoutMs: limits.timeoutSec * 1000,
    maxCostUsd: limits.maxCostUsd,
    onEvent: event => { if (event.phase === 'usage' && Number.isFinite(event.costUsd)) costUsd = event.costUsd; },
  };
  try {
    let validationErrors = [];
    let summary;
    if (key === 'skin_analysis') {
      const catalogue = await loadCatalogueImpl();
      const request = prepareSkinRequest({ quiz: sampleCase.quiz, language: sampleCase.language, images: [], catalogue, guidance });
      const output = await complete({ ...request, ...limitArgs });
      validationErrors = validateOutput(output, { quiz: sampleCase.quiz, language: sampleCase.language, images: [] }, catalogue).errors;
      summary = skinSummary(output);
    } else if (key === 'score_reading') {
      const { request, catalogue, call } = await prepareReadingCall(sampleCase.scan, guidance, loadCatalogueImpl);
      const output = await complete({ ...call, ...limitArgs });
      const reading = finishReading(output, request, catalogue);
      if (!reading) validationErrors = ['The reading had nothing usable after sanitising.'];
      summary = reading
        ? { startHere: reading.startHere, signals: reading.signals.length, productsNamed: reading.signals.filter(s => s.product).length }
        : null;
    } else if (key === 'market_picks') {
      // Lazy require: routes/ai.js itself requires aiConfig, so loading it at the top would be circular.
      const { cleanRecommendationList } = require('../../routes/ai');
      const request = buildMarketPicksRequest({ ...sampleCase, guidance });
      const output = await complete({ ...request, ...limitArgs });
      summary = {
        add: cleanRecommendationList(output?.add, sampleCase.add.length),
        replace: cleanRecommendationList(output?.replace, sampleCase.replace.length),
      };
    } else {
      return { ok: false, code: 'UNKNOWN_KEY' };
    }
    return { ok: validationErrors.length === 0, durationMs: Date.now() - startedAt, costUsd, validationErrors, summary };
  } catch (error) {
    // Only a fixed provider error code leaves this function, never provider text or input data.
    const code = typeof error?.code === 'string' && /^ANTHROPIC_[A-Z0-9_]+$/.test(error.code) ? error.code : 'TEST_FAILED';
    return { ok: false, code, durationMs: Date.now() - startedAt, costUsd };
  }
}

module.exports = { runTestCase };
