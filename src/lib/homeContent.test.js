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

// ---- Hebrew ----
const i18n = require('./i18n').default;
const { buildFallback } = require('../constants');
const heHome = require('../locales/he/home.json');
const heContent = require('../locales/he/content.json');
const heEras = require('../locales/he/eras.json');
const HEBREW = /[\u05D0-\u05EA]/; // alef..tav

// Every text (string leaf) of an object, in order.
const leaves = o => (typeof o === 'string' ? [o] : Object.values(o || {}).flatMap(leaves));

test('every mood id and every era has a Hebrew text', () => {
  for (const m of MOODS) expect(typeof heHome.moods[m.id]).toBe('string');
  for (const id of Object.keys(ERAS)) expect(typeof heContent.doneMsgs[id]).toBe('string');
});

describe('buildFallback follows the current language', () => {
  afterEach(() => i18n.changeLanguage('en'));

  test('Hebrew: same shape as English, every text Hebrew, era affirmation in Hebrew', async () => {
    const answers = { concerns: ['sensitive'], routine_products: ['cleanser'] };
    const en = buildFallback(answers);
    await i18n.changeLanguage('he');
    const he = buildFallback(answers);
    // Same structure and non-text values (era, priorities, list sizes).
    expect(he.eraId).toBe(en.eraId);
    expect(he.productAudit.add.map(a => a.priority)).toEqual(en.productAudit.add.map(a => a.priority));
    expect(he.routine.am).toHaveLength(en.routine.am.length);
    expect(he.routine.pm).toHaveLength(en.routine.pm.length);
    expect(he.productAudit.keep).toHaveLength(en.productAudit.keep.length);
    // Every text is Hebrew (not the raw key, not English).
    const texts = [he.skinAnalysis, ...he.keyInsights, he.affirmation,
      ...leaves(he.productAudit), ...leaves(he.routine)]
      .filter(t => !['essential', 'recommended'].includes(t));
    for (const t of texts) expect(t).toMatch(HEBREW);
    expect(he.affirmation).toBe(heEras[he.eraId].affirmation);
  });

  test('back in English the output is English again', async () => {
    await i18n.changeLanguage('he');
    await i18n.changeLanguage('en');
    expect(buildFallback({}).skinAnalysis).toMatch(/^Based on your assessment/);
  });
});

describe('progress text plural forms', () => {
  afterEach(() => i18n.changeLanguage('en'));

  test('English is "N/M steps complete" for every count', () => {
    for (const total of [0, 1, 2, 3, 11]) {
      expect(i18n.t('home:progress.steps', { count: total, done: 0, total })).toBe(`0/${total} steps complete`);
    }
  });

  test('Hebrew uses the one / two / other forms', async () => {
    await i18n.changeLanguage('he');
    const one = i18n.t('home:progress.steps', { count: 1, done: 1, total: 1 });
    const two = i18n.t('home:progress.steps', { count: 2, done: 1, total: 2 });
    const many = i18n.t('home:progress.steps', { count: 5, done: 3, total: 5 });
    // Each form is the one written in he/home.json, with the numbers filled in.
    expect(one).toBe(heHome.progress.steps_one.replace('{{done}}', '1'));
    expect(two).toBe(heHome.progress.steps_two.replace('{{done}}', '1'));
    expect(many).toBe(heHome.progress.steps_other.replace('{{done}}', '3').replace('{{total}}', '5'));
    expect(new Set([one, two, many]).size).toBe(3);
    // The line starts with U+200F so it stays right-to-left.
    for (const t of [one, two, many]) expect(t.startsWith('\u200F')).toBe(true);
  });
});
