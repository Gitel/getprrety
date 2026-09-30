// Checks that the quiz screens' way of reading text really works with the real i18next instance:
// list texts, group names, the {{name}} isolates and the "NoName" twins.
// (The screens themselves are React components and are not rendered in jest.)
jest.mock('./auth'); // constants.js imports api.js -> auth.js, which needs native plugins

const i18n = require('./i18n').default;
const { monthNames } = require('./formatting');

const ISO_OPEN = '\u2068';
const ISO_CLOSE = '\u2069';

describe('quiz text lookup with i18next (English)', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  test('lists (checklist, stages) come back as arrays and exist() sees them', () => {
    expect(i18n.exists('quiz:welcome.checklist')).toBe(true);
    expect(i18n.t('quiz:welcome.checklist', { returnObjects: true })).toEqual(
      ['Personalized routine', 'Product audit', 'Skin analysis', 'Lifestyle insights']);
    expect(i18n.t('quiz:completion.stages', { returnObjects: true })).toHaveLength(4);
    expect(i18n.t('quiz:photos.checklist', { returnObjects: true })).toHaveLength(4);
  });

  test('a question without a checklist / hint reports no text', () => {
    expect(i18n.exists('quiz:sleep.hint')).toBe(false);
    expect(i18n.exists('quiz:sleep.checklist')).toBe(false);
  });

  test('group names are found by position', () => {
    expect(i18n.t('quiz:skin_goals.groups.0')).toBe('Texture & Aging');
    expect(i18n.t('quiz:allergies.groups.1')).toBe('Skincare sensitivities');
  });

  test('the name is interpolated (with isolates) and the NoName twin has no placeholder', () => {
    expect(i18n.t('quiz:birthday.question', { name: `${ISO_OPEN}Dana${ISO_CLOSE}` }))
      .toBe(`When's your birthday, ${ISO_OPEN}Dana${ISO_CLOSE}?`);
    expect(i18n.t('quiz:birthday.questionNoName')).toBe("When's your birthday?");
    expect(i18n.t('quiz:completion.headlineNoName')).toBe('Your Skin Longevity Plan is ready.');
  });

  test('option keys with digits and underscores resolve', () => {
    expect(i18n.t('quiz:sleep.options.5_6.label')).toBe('5–6 hours');
    expect(i18n.t('quiz:water_intake.options.1_1_5l.label')).toBe('1–1.5L');
    expect(i18n.t('quiz:stress.labels.10')).toBe('Very high');
    expect(i18n.t('quiz:hormones.fields.regular_cycle.options.not_sure.label')).toBe('Not sure');
  });

  test('English month names are the old hard-coded list', () => {
    expect(monthNames('en')).toEqual(['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December']);
  });
});

describe('quiz text lookup with i18next (Hebrew)', () => {
  beforeAll(() => i18n.changeLanguage('he'));
  afterAll(() => i18n.changeLanguage('en'));

  test('lists and groups resolve in Hebrew, same length as English', () => {
    const heList = i18n.t('quiz:welcome.checklist', { returnObjects: true });
    expect(Array.isArray(heList)).toBe(true);
    expect(heList).toHaveLength(4);
    expect(i18n.t('quiz:completion.stages', { returnObjects: true })).toHaveLength(4);
    expect(i18n.t('quiz:skin_goals.groups.3')).toMatch(/[\u05D0-\u05EA]/);
  });

  test('the name is isolated and the NoName twin has no placeholder', () => {
    const named = i18n.t('quiz:birthday.question', { name: `${ISO_OPEN}Dana${ISO_CLOSE}` });
    expect(named).toContain(`${ISO_OPEN}Dana${ISO_CLOSE}`);
    expect(i18n.t('quiz:birthday.questionNoName')).not.toContain('{{');
  });

  test('number ranges are isolated so bidi does not reverse "5-6"', () => {
    expect(i18n.t('quiz:sleep.options.5_6.label')).toContain('\u20665\u20136\u2069');
  });

  test('the Hebrew city hint asks for the city in English', () => {
    expect(i18n.t('quiz:location.input.placeholder')).toContain('\u05D1\u05D0\u05E0\u05D2\u05DC\u05D9\u05EA');
  });

  test('month names come from Intl and are Hebrew', () => {
    const months = monthNames('he');
    expect(months).toHaveLength(12);
    months.forEach(m => expect(m).toMatch(/[\u05D0-\u05EA]/));
  });
});
