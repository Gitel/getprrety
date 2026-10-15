'use strict';

// Built-in defaults for the three admin-tunable AI tasks.
//
// Every prompt is split in two parts:
//   - lockedRules: owned by code (format/schema, safety, catalogue eligibility ...). Admins can
//     read them but never edit them, so no saved text can weaken a safety rule.
//   - guidance: the editable part (tone, persona, length). The text here is the DEFAULT guidance;
//     it equals the sentences that used to sit inside the old hard-coded prompt.
// Limits (timeout / output tokens / cost cap per request) are tuned within BOUNDS.

const fs = require('node:fs');
const path = require('node:path');
const { COMPACT_SYSTEM_INSTRUCTIONS } = require('../bedrock/compact');

// Allowed ranges, shared by the form validation and the admin page hints.
const BOUNDS = {
  timeoutSec: { min: 20, max: 90 },
  maxOutputTokens: { min: 500, max: 8000 },
  maxCostUsd: { min: 0.05, max: 0.5 },
  guidanceMax: 8000,
  noteMax: 200,
};

// analysisPrompt.md is the LOCKED part of the skin-analysis prompt (read once at start-up).
// tools/bedrock-eval and analysisContract.buildMessages still read the same file.
const SKIN_LOCKED = fs.readFileSync(path.join(__dirname, '..', 'bedrock', 'analysisPrompt.md'), 'utf8').trimEnd();

// "{language}" is replaced with English / Hebrew when the system prompt is assembled.
const SCORE_READING_LOCKED = 'Write the reading in {language} using only supplied quiz and score data. Never diagnose or promise a score change. Only mention a product whose exact name and ingredients appear in eligible_catalogue; otherwise set product to null. Never invent a product URL. Return start_here and signals in the required JSON shape.';

const MARKET_PICKS_LOCKED = 'Avoid products whose ingredients conflict with the supplied allergies, irritants, or pregnancy caution. Product ingredient lists are not supplied, so never claim a recommendation is allergy-safe or pregnancy-safe; if safety cannot be assessed, return an empty list for that item. Use only HTTPS URLs and return the requested strict JSON object.';

const DEFAULTS = {
  skin_analysis: {
    title: 'Skin analysis',
    lockedRules: SKIN_LOCKED,
    defaultGuidance: 'You are producing a cautious, cosmetic skin-care education summary.\n\nKeep user-facing prose compact: use 1\u20132 sentences for the summary and one short sentence for each insight, routine instruction, audit note, match reason, and safety flag. Avoid repeating the same caution while preserving every distinct safety concern.',
    defaultLimits: { timeoutSec: 90, maxOutputTokens: 8000, maxCostUsd: 0.25 },
  },
  score_reading: {
    title: 'Score reading',
    lockedRules: SCORE_READING_LOCKED,
    defaultGuidance: 'Write concise, supportive score-reading copy.',
    defaultLimits: { timeoutSec: 90, maxOutputTokens: 2000, maxCostUsd: 0.25 },
  },
  market_picks: {
    title: 'Market picks',
    lockedRules: MARKET_PICKS_LOCKED,
    defaultGuidance: 'Recommend reputable skincare products sold in the requested country.',
    defaultLimits: { timeoutSec: 90, maxOutputTokens: 1000, maxCostUsd: 0.25 },
  },
};

const KEYS = Object.keys(DEFAULTS);

// Locked rules first, then (only when not empty) the clinic guidance under a heading.
// skin_analysis keeps COMPACT_SYSTEM_INSTRUCTIONS last, exactly as skinRequest.js did before.
function assembleSystem(key, guidance, language) {
  const def = DEFAULTS[key];
  if (!def) throw new Error(`Unknown AI config key: ${key}`);
  const languageName = language === 'he' || language === 'Hebrew' ? 'Hebrew' : 'English';
  let system = def.lockedRules.replace('{language}', languageName);
  const text = typeof guidance === 'string' ? guidance.trim() : '';
  if (text) system += `\n\nClinic guidance:\n${text}`;
  if (key === 'skin_analysis') system += `\n\n${COMPACT_SYSTEM_INSTRUCTIONS}`;
  return system;
}

module.exports = { BOUNDS, DEFAULTS, KEYS, assembleSystem };
