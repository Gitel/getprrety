import { ERAS } from '../constants';
import { eraText, analysisAffirmation } from './eraText';

jest.mock('./auth');

const FIELDS = ['name', 'tagline', 'affirmation'];
const HEBREW = /[\u0590-\u05FF]/;

describe('eraText', () => {
  test('en returns the stored era text, else the ERAS text', () => {
    expect(eraText({ id: 'acne_reset', name: 'Admin Name' }, 'name', 'en')).toBe('Admin Name');
    expect(eraText({ id: 'acne_reset' }, 'name', 'en')).toBe(ERAS.acne_reset.name);
  });

  test('he returns Hebrew for every era and field', () => {
    for (const era of Object.values(ERAS)) {
      for (const f of FIELDS) {
        const text = eraText(era, f, 'he');
        expect(text).toMatch(HEBREW);
        expect(text).not.toBe(era[f]);
      }
    }
  });

  test('a stored English era object still shows Hebrew in he', () => {
    const stored = { ...ERAS.glow_building, name: 'Edited English name' };
    expect(eraText(stored, 'name', 'he')).toMatch(HEBREW);
  });

  test('unknown id falls back to the stored text; other languages use English', () => {
    expect(eraText({ id: 'nope', name: 'Stored' }, 'name', 'he')).toBe('Stored');
    expect(eraText(ERAS.acne_reset, 'name', 'fr')).toBe(ERAS.acne_reset.name);
  });

  test('null/undefined era gives an empty string', () => {
    expect(eraText(null, 'name', 'he')).toBe('');
    expect(eraText(undefined, 'tagline', 'en')).toBe('');
  });
});

describe('analysisAffirmation', () => {
  const era = ERAS.burnout_recovery;

  test('English template affirmation becomes Hebrew in he', () => {
    const analysis = { era, affirmation: `  ${era.affirmation} ` };
    expect(analysisAffirmation(analysis, 'he')).toBe(eraText(era, 'affirmation', 'he'));
  });

  test('Gemini/admin text is unchanged in he', () => {
    expect(analysisAffirmation({ era, affirmation: 'Custom text' }, 'he')).toBe('Custom text');
  });

  test('English is unchanged in en', () => {
    expect(analysisAffirmation({ era, affirmation: era.affirmation }, 'en')).toBe(era.affirmation);
  });

  test('missing affirmation uses the era affirmation in the current language', () => {
    expect(analysisAffirmation({ era }, 'en')).toBe(era.affirmation);
    expect(analysisAffirmation({ era }, 'he')).toBe(eraText(era, 'affirmation', 'he'));
    expect(analysisAffirmation({ eraId: 'acne_reset' }, 'en')).toBe(ERAS.acne_reset.affirmation);
    expect(analysisAffirmation(null, 'he')).toBe('');
  });
});
