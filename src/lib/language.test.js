import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, normalizeLanguage, isRTL, dirFor } from './language';

describe('language helpers', () => {
  test('constants', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['en', 'he']);
    expect(DEFAULT_LANGUAGE).toBe('en');
  });

  test('normalizeLanguage accepts region variants, any casing and the legacy iw code', () => {
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('en_GB')).toBe('en');
    expect(normalizeLanguage('he')).toBe('he');
    expect(normalizeLanguage('he-IL')).toBe('he');
    expect(normalizeLanguage('HE')).toBe('he');
    expect(normalizeLanguage(' iw ')).toBe('he');
    expect(normalizeLanguage('iw-IL')).toBe('he');
  });

  test('normalizeLanguage returns null for anything else', () => {
    for (const bad of ['fr', 'ar', '', 'hebrew', null, undefined, 5, {}, []]) {
      expect(normalizeLanguage(bad)).toBeNull();
    }
  });

  test('isRTL and dirFor', () => {
    expect(isRTL('he')).toBe(true);
    expect(isRTL('he-IL')).toBe(true);
    expect(isRTL('en')).toBe(false);
    expect(isRTL('xx')).toBe(false);
    expect(isRTL(undefined)).toBe(false);
    expect(dirFor('he')).toBe('rtl');
    expect(dirFor('en')).toBe('ltr');
    expect(dirFor(null)).toBe('ltr');
  });
});
