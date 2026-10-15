const { runTestCase } = require('./testRun');
const { listSampleCases, getSampleCase, SAMPLE_CASES } = require('./sampleCases');
const { sanitizeQuiz } = require('../bedrock/analysisContract');
const { buildReadingRequest } = require('../skinScan/scoreReading');
const { DEFAULTS } = require('./defaults');

const SETTINGS = { guidance: 'Test tone.', limits: { timeoutSec: 40, maxOutputTokens: 900, maxCostUsd: 0.12 } };
const product = { _id: '507f1f77bcf86cd799439011', name: 'Calm Cream', category: 'face_creams', use: 'home',
  pregnancy: 'safe', archived: false, keyActives: ['ceramides'], strengths: [], suitableFor: [], ingredients: 'Aqua, Glycerin' };

// A valid skin analysis (same shape as routes/ai.test.js uses).
const validAnalysis = () => ({
  era: {
    era: { id: 'barrier_healing', affirmation: 'Gentle care is enough.' },
    skin_analysis: { summary: 'A gentle and consistent routine can support comfort.', key_insights: [] },
    routine: {
      am: [
        { category_id: 'cleanse', category: 'Cleanser', instruction: 'Cleanse gently.' },
        { category_id: 'moisturize', category: 'Moisturizer', instruction: 'Apply moisturizer.' },
        { category_id: 'protect', category: 'Sun protection', instruction: 'Apply sunscreen.' },
      ],
      pm: [
        { category_id: 'cleanse', category: 'Cleanser', instruction: 'Cleanse gently.' },
        { category_id: 'moisturize', category: 'Moisturizer', instruction: 'Apply moisturizer.' },
      ],
    },
    product_audit: { current_products_assessment: [], most_urgent_gap: null },
    check_in_prompts: [], safety_flags: ['Stop if irritation develops.'], event_prep: null,
  },
  srProducts: null,
  shelfAnalysis: null,
});

// completeJson fake: records the call, reports a usage event like the real client, returns `output`.
function fakeComplete(output) {
  return jest.fn(async args => {
    args.onEvent({ phase: 'usage', costUsd: 0.0123 });
    return typeof output === 'function' ? output(args) : output;
  });
}
const deps = (complete, extra = {}) => ({ isConfigured: () => true, completeJson: complete, loadCatalogue: jest.fn(async () => [product]), ...extra });

describe('runTestCase', () => {
  test('BEDROCK_NOT_CONFIGURED short-circuits: nothing is loaded or called', async () => {
    const complete = jest.fn();
    const loadCatalogue = jest.fn();
    const result = await runTestCase('skin_analysis', getSampleCase('skin_analysis', 'en_basic'), SETTINGS,
      { isConfigured: () => false, completeJson: complete, loadCatalogue });
    expect(result).toEqual({ ok: false, code: 'BEDROCK_NOT_CONFIGURED' });
    expect(complete).not.toHaveBeenCalled();
    expect(loadCatalogue).not.toHaveBeenCalled();
  });

  test('skin_analysis: one call with the form guidance + limits, validated, cost reported', async () => {
    const complete = fakeComplete(validAnalysis());
    const result = await runTestCase('skin_analysis', getSampleCase('skin_analysis', 'en_basic'), SETTINGS, deps(complete));
    expect(complete).toHaveBeenCalledTimes(1);
    const args = complete.mock.calls[0][0];
    expect(args.system).toContain('Clinic guidance:\nTest tone.');
    expect(args).toMatchObject({ maxOutputTokens: 900, timeoutMs: 40_000, maxCostUsd: 0.12 });
    expect(args.wireSchema).toBeDefined(); // same compact request as production
    expect(JSON.stringify(args.messages)).toContain('Calm Cream'); // live catalogue is used
    expect(result).toMatchObject({ ok: true, costUsd: 0.0123, validationErrors: [] });
    expect(result.durationMs).toEqual(expect.any(Number));
    expect(result.summary).toMatchObject({ era: 'barrier_healing', amSteps: 3, pmSteps: 2 });
  });

  test('skin_analysis: semantic validation errors are returned (not thrown) and make ok false', async () => {
    const bad = validAnalysis();
    bad.era.routine.am = [bad.era.routine.am[0]]; // too few steps / no protection
    const result = await runTestCase('skin_analysis', getSampleCase('skin_analysis', 'en_basic'), SETTINGS, deps(fakeComplete(bad)));
    expect(result.ok).toBe(false);
    expect(result.validationErrors.length).toBeGreaterThan(0);
    expect(result.code).toBeUndefined();
  });

  test('skin_analysis: a provider failure gives only the fixed error code', async () => {
    const complete = jest.fn(async () => { throw Object.assign(new Error('secret provider text'), { code: 'BEDROCK_TIMEOUT' }); });
    const result = await runTestCase('skin_analysis', getSampleCase('skin_analysis', 'en_basic'), SETTINGS, deps(complete));
    expect(result).toMatchObject({ ok: false, code: 'BEDROCK_TIMEOUT' });
    expect(JSON.stringify(result)).not.toContain('secret');
    const other = await runTestCase('skin_analysis', getSampleCase('skin_analysis', 'en_basic'), SETTINGS,
      deps(jest.fn(async () => { throw new Error('anything'); })));
    expect(other).toMatchObject({ ok: false, code: 'TEST_FAILED' });
  });

  test('score_reading: builds the production request and sanitises the reading', async () => {
    const complete = fakeComplete({
      start_here: { title: 'Wear SPF', body: 'One habit moves the most.' },
      signals: [{ key: 'barrier', potential: 90, weeks: '6 weeks', driver: 'd', why: 'w', lever: 'l', shelf: null, product: { name: 'Calm Cream', actives: 'x', url: 'https://evil.example' } }],
    });
    const result = await runTestCase('score_reading', getSampleCase('score_reading', 'default'), SETTINGS, deps(complete));
    const args = complete.mock.calls[0][0];
    expect(args.schemaName).toBe('skin_score_reading');
    expect(args.system).toContain('Clinic guidance:\nTest tone.');
    expect(args).toMatchObject({ maxOutputTokens: 900, timeoutMs: 40_000, maxCostUsd: 0.12 });
    expect(result).toMatchObject({ ok: true, summary: { startHere: { title: 'Wear SPF' }, productsNamed: 1 } });
  });

  test('score_reading: an unusable answer is reported as a validation error', async () => {
    const result = await runTestCase('score_reading', getSampleCase('score_reading', 'default'), SETTINGS, deps(fakeComplete({ start_here: null, signals: [] })));
    expect(result.ok).toBe(false);
    expect(result.validationErrors).toHaveLength(1);
  });

  test('market_picks: same request builder as the route, https-only sanitising', async () => {
    const complete = fakeComplete({ add: [{ index: 0, rec: { brand: 'B', name: 'N', price: '$1', retailer: 'R', url: 'http://insecure.example' } }], replace: [] });
    const result = await runTestCase('market_picks', getSampleCase('market_picks', 'default'), SETTINGS, deps(complete));
    const args = complete.mock.calls[0][0];
    expect(args.schemaName).toBe('product_recommendations');
    expect(args.system).toContain('Clinic guidance:\nTest tone.');
    expect(args.messages[0].content).toContain('Country: Israel');
    expect(result.ok).toBe(true);
    expect(result.summary.add[0].rec.url).toBe(''); // http:// is dropped
  });

  test('an unknown key returns UNKNOWN_KEY without calling the provider', async () => {
    const complete = jest.fn();
    expect(await runTestCase('nope', {}, SETTINGS, deps(complete))).toEqual({ ok: false, code: 'UNKNOWN_KEY' });
    expect(complete).not.toHaveBeenCalled();
  });

  test('default guidance + default limits reproduce the production call arguments', async () => {
    const complete = fakeComplete({ add: [], replace: [] });
    const d = DEFAULTS.market_picks;
    await runTestCase('market_picks', getSampleCase('market_picks'), { guidance: d.defaultGuidance, limits: d.defaultLimits }, deps(complete));
    expect(complete.mock.calls[0][0]).toMatchObject({ maxOutputTokens: 1000, timeoutMs: 90_000, maxCostUsd: 0.25 });
  });
});

describe('sample cases', () => {
  test('skin_analysis offers en_basic, he_pregnancy and en_allergy; the others a single default', () => {
    expect(listSampleCases('skin_analysis').map(c => c.id)).toEqual(['en_basic', 'he_pregnancy', 'en_allergy']);
    expect(listSampleCases('score_reading').map(c => c.id)).toEqual(['default']);
    expect(listSampleCases('market_picks').map(c => c.id)).toEqual(['default']);
    expect(listSampleCases('nope')).toEqual([]);
  });

  test('getSampleCase: by id, first case when no id, undefined when unknown', () => {
    expect(getSampleCase('skin_analysis', 'he_pregnancy').language).toBe('he');
    expect(getSampleCase('skin_analysis').id).toBe('en_basic');
    expect(getSampleCase('skin_analysis', 'nope')).toBeUndefined();
  });

  test('skin quizzes pass the production whitelist unchanged (already minimized) and carry no photos', () => {
    for (const item of SAMPLE_CASES.skin_analysis) {
      expect(sanitizeQuiz(item.quiz)).toEqual(item.quiz);
      expect(item.images).toBeUndefined();
    }
  });

  test('the score-reading scan produces a real request with signals', () => {
    const request = buildReadingRequest(SAMPLE_CASES.score_reading[0].scan);
    expect(request.scan.signals.length).toBeGreaterThan(0);
    expect(request.language).toBe('en');
  });

  test('the pregnancy sample really activates the pregnancy caution', () => {
    const { isPregnancyCaution } = require('../bedrock/analysisContract');
    expect(isPregnancyCaution(getSampleCase('skin_analysis', 'he_pregnancy').quiz)).toBe(true);
    expect(isPregnancyCaution(getSampleCase('skin_analysis', 'en_basic').quiz)).toBe(false);
  });
});
