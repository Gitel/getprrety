import { mapToAppFormat, buildQuizPayload, ageFromBirthday, ageRange } from './analyzeWithRailway';

jest.mock('./auth');

const TODAY = new Date(2026, 8, 23); // 23 Sep 2026, month is 0-based

describe('buildQuizPayload - fields restored/fixed for Gemini', () => {
  test('skin tone I-VI becomes fitzpatrick 1-6; unanswered is null, not an invented 2', () => {
    expect(buildQuizPayload({ tone: 'III' }, TODAY).fitzpatrick).toBe(3);
    expect(buildQuizPayload({ tone: 'VI' }, TODAY).fitzpatrick).toBe(6);
    expect(buildQuizPayload({}, TODAY).fitzpatrick).toBeNull();
  });

  test('birthday becomes raw age plus a 10-year bucket', () => {
    const payload = buildQuizPayload({ birthday: '15/03/1995' }, TODAY);
    expect(payload.age).toBe(31);
    expect(payload.age_range).toBe('25-34');
  });

  test('no birthday: age and age_range are null', () => {
    const payload = buildQuizPayload({}, TODAY);
    expect(payload.age).toBeNull();
    expect(payload.age_range).toBeNull();
  });

  test('breastfeeding counts as pregnant_or_ttc (women only, as before)', () => {
    expect(buildQuizPayload({ gender: 'she', hormones: { breastfeeding: 'yes' } }, TODAY).pregnant_or_ttc).toBe('yes');
    expect(buildQuizPayload({ gender: 'she', hormones: { pregnant: 'yes' } }, TODAY).pregnant_or_ttc).toBe('yes');
    expect(buildQuizPayload({ gender: 'she', hormones: { breastfeeding: 'no' } }, TODAY).pregnant_or_ttc).toBe('no');
    expect(buildQuizPayload({ gender: 'he', hormones: { breastfeeding: 'yes' } }, TODAY).pregnant_or_ttc).toBe('no');
  });

  test("'No special event' is sent as the contract's 'none'", () => {
    expect(buildQuizPayload({ event: 'no_event' }, TODAY).event_type).toBe('none');
    expect(buildQuizPayload({}, TODAY).event_type).toBe('none');
    expect(buildQuizPayload({ event: 'wedding' }, TODAY).event_type).toBe('wedding');
  });
});

describe('ageFromBirthday', () => {
  test('counts a birthday not yet reached this year as one year younger', () => {
    expect(ageFromBirthday('24/09/2000', TODAY)).toBe(25); // tomorrow
    expect(ageFromBirthday('23/09/2000', TODAY)).toBe(26); // today
  });

  test('rejects malformed input', () => {
    expect(ageFromBirthday('2000-09-23', TODAY)).toBeNull();
    expect(ageFromBirthday(undefined, TODAY)).toBeNull();
  });
});

describe('ageRange', () => {
  test.each([
    [12, 'under-18'], [17, 'under-18'], [18, '18-24'], [24, '18-24'], [25, '25-34'],
    [44, '35-44'], [54, '45-54'], [64, '55-64'], [65, '65+'], [null, null],
  ])('age %p -> %p', (age, bucket) => {
    expect(ageRange(age)).toBe(bucket);
  });
});

// Minimal Railway response in the shape mapToAppFormat reads. The real shape is owned by
// the Railway service and must be re-confirmed against a live response once it is back.
function railway({ eraId = 'glow_building', am, pm, srProducts } = {}) {
  return {
    era: {
      era: eraId ? { id: eraId, affirmation: 'I glow.' } : {},
      skin_analysis: { summary: 'Healthy barrier.', key_insights: [{ title: 'Hydration', body: 'Good' }] },
      routine: {
        am: am ?? [{ category: 'Cleanser', instruction: 'Lukewarm water' }],
        pm: pm ?? [{ category: 'Moisturizer', instruction: 'Pea-sized' }],
      },
      product_audit: {},
    },
    srProducts: srProducts ?? null,
  };
}

describe('mapToAppFormat', () => {
  test('maps a valid response and marks it as a real Gemini result', () => {
    const result = mapToAppFormat(railway(), {});
    expect(result.source).toBe('gemini');
    expect(result.eraId).toBe('glow_building');
    expect(result.routine.am).toEqual([{ name: 'Cleanser', description: 'Lukewarm water' }]);
    expect(result.keyInsights).toEqual(['Hydration: Good']);
  });

  test('carries srProducts on the analysis so it is saved with it', () => {
    const srProducts = { am: [{ step: 1, routine_category: 'cleanser' }], pm: [] };
    expect(mapToAppFormat(railway({ srProducts }), {}).srProducts).toBe(srProducts);
  });

  test('rejects a response with no era id (used to become an empty barrier_healing result)', () => {
    expect(() => mapToAppFormat(railway({ eraId: null }), {})).toThrow('no era id');
  });

  test('rejects a response with no routine steps anywhere', () => {
    expect(() => mapToAppFormat(railway({ am: [], pm: [] }), {})).toThrow('no routine steps');
  });

  test('accepts an empty generic routine when the product routine has steps', () => {
    const srProducts = { am: [{ step: 1, routine_category: 'cleanser' }], pm: [] };
    expect(() => mapToAppFormat(railway({ am: [], pm: [], srProducts }), {})).not.toThrow();
  });

  test('rejects a completely unexpected body', () => {
    expect(() => mapToAppFormat({ error: 'quota exceeded' }, {})).toThrow('Invalid analysis response');
    expect(() => mapToAppFormat(null, {})).toThrow('Invalid analysis response');
  });
});
