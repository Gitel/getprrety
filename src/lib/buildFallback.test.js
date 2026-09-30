// Safety net for moving the generic fallback analysis text into i18n (content.json).
// The snapshot was taken on the ORIGINAL code: in English, buildFallback must return exactly the
// same object as before the refactor. Do not update the snapshot to make a change "pass".
jest.mock('./auth'); // constants.js imports api.js -> auth.js, which needs native plugins

const { buildFallback } = require('../constants');

// Answer sets that hit every era branch and both hasProd branches.
const ANSWER_SETS = {
  empty: {},
  sensitiveWithProducts: { concerns: ['sensitive'], routine_products: ['cleanser', 'moisturizer'] },
  acneNoProducts: { concerns: ['acne'], routine_products: ['none'] },
  smoker: { smoke: 'daily', routine_products: [] },
  dullness: { skin_goals: ['dull_skin'], routine_products: ['spf'] },
  wrinkles: { concerns: ['fine_lines'] },
};

test.each(Object.keys(ANSWER_SETS))('buildFallback (English) is unchanged: %s', name => {
  expect(buildFallback(ANSWER_SETS[name])).toMatchSnapshot();
});
