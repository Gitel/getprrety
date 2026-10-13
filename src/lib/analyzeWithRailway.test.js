import { mapToAppFormat, buildQuizPayload, minimizeQuizAnswers, buildProductSafetyContext, analyzeSkin, ageFromBirthday, ageRange } from './analyzeWithRailway';
import { fetchProductRecs } from '../constants';

jest.mock('./auth');
jest.mock('./api', () => ({ api: { post: jest.fn() } }));
jest.mock('./downscaleImage', () => ({ downscaleDataUrl: jest.fn(async value => value) }));

import { api } from './api';

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

describe('minimizeQuizAnswers safety answers', () => {
  test('leaves skipped allergy and irritant questions absent instead of inventing no answers', () => {
    const payload = minimizeQuizAnswers({ gender: 'she' });
    expect(payload).not.toHaveProperty('allergies');
    expect(payload).not.toHaveProperty('allergies_other');
    expect(payload).not.toHaveProperty('irritants');
    expect(payload).not.toHaveProperty('irritants_other');
    expect(payload).not.toHaveProperty('pregnant_or_ttc');
    expect(payload).not.toHaveProperty('hormones');
  });

  test('keeps positive pregnancy caution when only one hormone answer is present', () => {
    const payload = minimizeQuizAnswers({ gender: 'she', hormones: { pregnant: 'yes' } });
    expect(payload.pregnant_or_ttc).toBe('yes');
    expect(payload).not.toHaveProperty('hormones');
  });

  test('omits a negative for partially answered hormones but emits one for complete explicit answers', () => {
    expect(minimizeQuizAnswers({ gender: 'she', hormones: { pregnant: 'no' } })).not.toHaveProperty('pregnant_or_ttc');
    const complete = minimizeQuizAnswers({
      gender: 'she', hormones: { pregnant: 'no', trying_to_conceive: 'no', breastfeeding: 'no' },
      allergies: ['none'], irritants: ['nothing'],
    });
    expect(complete).toMatchObject({ pregnant_or_ttc: 'no', allergies: ['none'], irritants: ['nothing'] });
  });

  test('retains valid explicit legacy pregnancy answers and explicit inapplicability', () => {
    expect(minimizeQuizAnswers({ pregnant_or_ttc: 'no' }).pregnant_or_ttc).toBe('no');
    expect(minimizeQuizAnswers({ gender: 'he' }).pregnant_or_ttc).toBe('no');
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

  test('preserves the provider source returned by the backend', () => {
    expect(mapToAppFormat({ ...railway(), source: 'bedrock' }, {}).source).toBe('bedrock');
  });
});

describe('Bedrock request', () => {
  beforeEach(() => api.post.mockReset());

  test('sends mapped quiz answers, labelled downscaled images, and the current supported language', async () => {
    const response = { ...railway(), source: 'bedrock' };
    api.post.mockResolvedValueOnce(response);
    const answers = {
      gender: 'she', tone: 'III', skin_goals: ['acne'],
      front: 'data:image/jpeg;base64,Zm9udA==',
      shelf_photos: ['data:image/jpeg;base64,c2hlbGY='],
    };

    const result = await analyzeSkin(answers, 'he-IL');
    const [path, body, options] = api.post.mock.calls[0];
    expect(path).toBe('/api/ai/analyze-skin');
    expect(body.quizAnswers).toMatchObject({ identity: 'she', fitzpatrick: 3 });
    expect(body.language).toBe('he');
    expect(body.images).toEqual([
      { angle: 'front', mediaType: 'image/jpeg', base64: 'Zm9udA==' },
      { angle: 'shelf', mediaType: 'image/jpeg', base64: 'c2hlbGY=' },
    ]);
    expect(options).toMatchObject({ timeoutMs: 90000, stream: true });
    expect(result.source).toBe('bedrock');
  });

  test('forwards only the caller progress callback to streaming mode', async () => {
    api.post.mockResolvedValueOnce({ ...railway(), source: 'bedrock' });
    const onProgress = jest.fn();
    await analyzeSkin({}, 'en', onProgress);
    expect(api.post.mock.calls[0][2]).toMatchObject({ timeoutMs: 90000, stream: true, onProgress });
  });

  test('rejects an image over the provider request limit before posting', async () => {
    const large = 'A'.repeat(Math.ceil((8 * 1024 * 1024 + 1) * 4 / 3));
    await expect(analyzeSkin({ front: `data:image/jpeg;base64,${large}` }, 'en')).rejects.toThrow('image is too large');
    expect(api.post).not.toHaveBeenCalled();
  });

  test('preserves a provider timeout/error for LoadingScreen fallback handling', async () => {
    api.post.mockRejectedValueOnce(new Error('Request timed out after 90000ms'));
    await expect(analyzeSkin({}, 'en')).rejects.toThrow('90000ms');
  });
});

test('buildProductSafetyContext keeps only minimized product-safety quiz fields', () => {
  expect(buildProductSafetyContext({
    gender: 'she', hormones: { pregnant: 'yes', breastfeeding: 'no', trying_to_conceive: 'no' }, allergies: ['fragrance'], allergies_other: 'latex',
    irritants: ['ahas_bhas'], irritants_other: 'peppermint', health_conditions: ['diabetes'],
    diagnosed_conditions: ['eczema'], name: 'Private Name', birthday: '1/1/1990', front: 'private photo',
  })).toEqual({
    pregnant_or_ttc: 'yes', allergies: ['fragrance'], allergies_other: 'latex',
    irritants: ['ahas_bhas'], irritants_other: 'peppermint', health_conditions: ['diabetes'],
    diagnosed_conditions: ['eczema'],
  });
});

test('legacy saved answers stay incomplete instead of receiving invented safety defaults', () => {
  expect(buildProductSafetyContext({ name: 'Private Name', skin_goals: ['acne'] })).toEqual({});
  expect(buildProductSafetyContext({ allergies: ['none'], irritants: ['nothing'] })).toEqual({
    allergies: ['none'], irritants: ['nothing'],
  });
});

test('current explicit no-restriction answers preserve their sentinels and pregnancy answer', () => {
  expect(buildProductSafetyContext({
    gender: 'she', hormones: { pregnant: 'no', breastfeeding: 'no', trying_to_conceive: 'no' },
    allergies: ['none'], irritants: ['nothing'],
  })).toEqual({ pregnant_or_ttc: 'no', allergies: ['none'], irritants: ['nothing'] });
});

test('product recommendation request forwards language and minimized safety context', async () => {
  api.post.mockResolvedValueOnce({ add: [], replace: [] });
  await fetchProductRecs({ add: [{ product: 'Moisturizer' }], replace: [] }, 'Israel', 'Barrier Era', {
    language: 'he', safetyContext: { pregnant_or_ttc: 'yes', allergies: ['fragrance'] },
  });
  expect(api.post).toHaveBeenCalledWith('/api/ai/product-recommendations', {
    productAudit: { add: [{ product: 'Moisturizer' }], replace: [] }, country: 'Israel', eraName: 'Barrier Era',
    language: 'he', safetyContext: { pregnant_or_ttc: 'yes', allergies: ['fragrance'] },
  }, { timeoutMs: 60000 });
});
