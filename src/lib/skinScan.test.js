import { scanQuizAnswers, scanLanguage, initAndStartScan } from './skinScan';

// skinScan.js imports auth.js (Capacitor Preferences); the helper under test never uses it.
jest.mock('./auth');
// A fake i18n instance whose language each test can change.
jest.mock('./i18n', () => ({ __esModule: true, default: { language: 'en' } }));
const i18n = require('./i18n').default;

const TODAY = new Date(2026, 8, 27); // 27 Sep 2026

describe('scanQuizAnswers - the whitelist stored on the scan', () => {
  const full = {
    name: 'Dana', birthday: '15/03/1990', city: 'Tel Aviv', gender: 'she', tone: 'III',
    skin_goals: ['dryness', 'pigmentation'], top_concern: 'dryness', post_cleanse_feel: 'tight_then_oily',
    work_environment: 'office', irritants: ['fragrance'], routine_products: ['cleanser', 'serum'],
    water_intake: 'less_1l', sleep: '6_7', stress: 7, alcohol: 'rarely', smoke: 'never', exercise: 'weekly',
    allergies: ['none'], diagnosed_conditions: ['none'], health_conditions: ['diabetes'],
    hormones: { pregnant: 'no', breastfeeding: 'no' },
    front: 'data:image/jpeg;base64,AAAA', skinScanToken: 'secret',
  };
  const result = scanQuizAnswers(full, TODAY);

  test('keeps the answers the fusion engine and the reading copy need', () => {
    expect(result).toMatchObject({
      skin_goals: ['dryness', 'pigmentation'], top_concern: 'dryness', post_cleanse_feel: 'tight_then_oily',
      gender: 'she', tone: 'III', routine_products: ['cleanser', 'serum'], water_intake: 'less_1l', stress: 7,
    });
  });

  test('sends age instead of the birthday', () => {
    expect(result.age).toBe(36);
    expect(result.birthday).toBeUndefined();
  });

  test('never stores name, city, health conditions, raw hormones or photos', () => {
    ['name', 'city', 'health_conditions', 'hormones', 'front', 'skinScanToken']
      .forEach(key => expect(result[key]).toBeUndefined());
  });

  test('pregnancy / breastfeeding become one flag, women only (same rule as the Era analysis)', () => {
    expect(result.pregnancy_caution).toBe(false);
    expect(scanQuizAnswers({ gender: 'she', hormones: { breastfeeding: 'yes' } }).pregnancy_caution).toBe(true);
    expect(scanQuizAnswers({ gender: 'she', hormones: { trying_to_conceive: 'yes' } }).pregnancy_caution).toBe(true);
    expect(scanQuizAnswers({ gender: 'he', hormones: { pregnant: 'yes' } }).pregnancy_caution).toBe(false);
  });

  test('unanswered questions are left out rather than sent as null', () => {
    const partial = scanQuizAnswers({ skin_goals: ['acne'], top_concern: null });
    expect(partial).toEqual({ skin_goals: ['acne'], pregnancy_caution: false });
  });
});

describe('scan init sends the UI language', () => {
  afterEach(() => { i18n.language = 'en'; delete global.fetch; });

  test('scanLanguage normalizes to en | he and falls back to en', () => {
    i18n.language = 'he'; expect(scanLanguage()).toBe('he');
    i18n.language = 'he-IL'; expect(scanLanguage()).toBe('he');
    i18n.language = 'en-US'; expect(scanLanguage()).toBe('en');
    i18n.language = 'fr'; expect(scanLanguage()).toBe('en');
    i18n.language = undefined; expect(scanLanguage()).toBe('en');
  });

  test('the init request body carries language', async () => {
    i18n.language = 'he';
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    await initAndStartScan({ front: 'data:image/jpeg;base64,AAAA', quizAnswers: {} });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.language).toBe('he');
    expect(body.photos).toHaveLength(1);
  });
});
