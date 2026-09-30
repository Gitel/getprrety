// Checks that Home's run-time keys exist: moods (by MOODS id) and done messages (by ERAS id).
// The static-keys test (i18nKeys.test.js) cannot see these because the keys are built at run time.
jest.mock('./auth'); // constants.js imports api.js -> auth.js, which needs native plugins

const { MOODS, ERAS } = require('../constants');
const enHome = require('../locales/en/home.json');
const enContent = require('../locales/en/content.json');

test('MOODS ids are the agreed ones and the stored labels are English words', () => {
  expect(MOODS.map(m => m.id)).toEqual(['glowing', 'calm', 'tired', 'reactive', 'breaking_out']);
  // The check-in POST and HomeScreen's lookup use the label, so it must stay English.
  expect(MOODS.map(m => m.label)).toEqual(['Glowing', 'Calm', 'Tired', 'Reactive', 'Breaking out']);
});

test('English mood text equals the stored label (pixel-identical English UI)', () => {
  for (const m of MOODS) expect(enHome.moods[m.id]).toBe(m.label);
});

test('every era has an English done message', () => {
  for (const id of Object.keys(ERAS)) expect(typeof enContent.doneMsgs[id]).toBe('string');
});
