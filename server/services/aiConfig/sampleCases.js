'use strict';

// Built-in SYNTHETIC inputs for the admin "Test" button. They contain no real customer data.
// Each skin_analysis quiz is already in the minimized shape routes/ai.js passes to the prompt
// builder (whitelisted keys only, see analysisContract.sanitizeQuiz); no photos are included.

// Shared answers: complete safety answers are added per case so catalogue products can be selected.
const BASE_QUIZ = {
  age: '34', gender: 'female', fitzpatrick: 3,
  concerns: ['dryness', 'dullness'], skin_goals: ['hydration'], top_concern: 'dryness',
  post_cleanse_feel: 'tight', sleep: '7_8', stress: 4, water_intake: '1_2l',
  smoke: 'no', alcohol: 'rarely', exercise: 'weekly', event_type: 'none',
};

const SKIN_ANALYSIS = [
  {
    id: 'en_basic', label: 'English - no restrictions', language: 'en',
    quiz: { ...BASE_QUIZ, allergies: ['none'], irritants: ['none'], pregnant_or_ttc: 'no' },
  },
  {
    id: 'he_pregnancy', label: 'Hebrew - pregnancy caution', language: 'he',
    quiz: { ...BASE_QUIZ, allergies: ['none'], irritants: ['none'], pregnant_or_ttc: 'yes', pregnancy_caution: true },
  },
  {
    id: 'en_allergy', label: 'English - fragrance allergy, retinoid irritation', language: 'en',
    quiz: { ...BASE_QUIZ, allergies: ['fragrance'], irritants: ['retinoids'], pregnant_or_ttc: 'no' },
  },
];

// A scan in the shape scoreReading.buildReadingRequest expects (stored quiz snapshot + merged scores).
const SCORE_READING = [{
  id: 'default', label: 'Combination skin, mid scores', language: 'en',
  scan: {
    language: 'en',
    quizSnapshot: {
      age: '34', gender: 'female', safetyContextVersion: 1,
      allergies: ['none'], irritants: ['none'], pregnant_or_ttc: 'no',
    },
    merged: {
      concerns: {
        moisture: { raw: 48.94 }, oiliness: { raw: 63.45 }, pore: { raw: 52.34 }, texture: { raw: 88.17 },
        acne: { raw: 93.98 }, radiance: { raw: 76.8 }, redness: { raw: 68.27 }, age_spot: { raw: 71.4 },
        wrinkle: { raw: 74.79 }, firmness: { raw: 85.12 },
      },
      overall: { raw: 75.93 }, skinAge: 37, skinType: { whole: 'Combination' },
    },
  },
}];

// Needs list + country + era, like the product-recommendations route builds from a saved audit.
const MARKET_PICKS = [{
  id: 'default', label: 'Cleanser, sunscreen and one swap', language: 'en',
  add: [{ product: 'Gentle gel cleanser' }, { product: 'Daily sunscreen for sensitive skin' }],
  replace: [{ from: 'Harsh scrub', to: 'Gentle enzyme exfoliant' }],
  country: 'Israel', eraName: 'Barrier healing',
  safetyContext: { allergies: [], irritants: [], pregnancyCaution: false, limitations: [] },
}];

const SAMPLE_CASES = { skin_analysis: SKIN_ANALYSIS, score_reading: SCORE_READING, market_picks: MARKET_PICKS };

// The cases offered in the admin select for a key: [{ id, label }].
function listSampleCases(key) {
  return (SAMPLE_CASES[key] || []).map(({ id, label }) => ({ id, label }));
}

// One case by id (the first case when the id is missing); undefined for an unknown key / id.
function getSampleCase(key, id) {
  const cases = SAMPLE_CASES[key] || [];
  return id === undefined || id === null || id === '' ? cases[0] : cases.find(item => item.id === id);
}

module.exports = { SAMPLE_CASES, listSampleCases, getSampleCase };
