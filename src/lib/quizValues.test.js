// Safety net for the quiz translation work. It snapshots every VALUE the quiz stores or sends
// (question ids, types, option values, field keys, slider range, skin tone values, mood labels).
// Text shown to the user is being moved into i18n files, but these values must never change,
// because they are saved with the user's answers and read by the server.
// The snapshot was taken on the ORIGINAL code, before the refactor.
jest.mock('./auth'); // constants.js imports api.js -> auth.js, which needs native plugins

const { QUESTIONS, SKIN_TONES, MOODS } = require('../constants');

const vals = (list) => (list || []).map(o => o.value);

function describeQuestion(q) {
  return {
    id: q.id,
    type: q.type,
    options: vals(q.options),
    extraOptions: vals(q.extraOptions),
    groups: (q.groups || []).map(g => vals(g.options)),
    fields: (q.fields || []).map(f => ({ key: f.key, options: vals(f.options) })),
    min: q.min,
    max: q.max,
  };
}

test('quiz question ids, types and stored values are unchanged', () => {
  expect(QUESTIONS.map(describeQuestion)).toMatchSnapshot();
});

test('skin tone values are unchanged', () => {
  expect(SKIN_TONES.map(t => t.value)).toMatchSnapshot();
});

test('mood labels (stored values) are unchanged', () => {
  expect(MOODS.map(m => m.label)).toMatchSnapshot();
});
