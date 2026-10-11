// Bedrock client contract checks. API traffic is intercepted per test so these exercises never
// call a provider or real backend; the only saved-analysis POSTs go through the existing mock.
import { test, expect } from './support/test.js';
import { ANALYSIS, FIRST_TIME_USER } from './support/fixtures-data.js';
import { walkQuizToLoading } from './support/quiz.js';
import { openHome, openProfileFromHome } from './support/nav.js';

const ANALYZE_URL = 'http://api.e2e.test/api/ai/analyze-skin';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SAFETY_TEXT = {
  en: 'Stop using a new product if irritation develops.',
  he: 'הפסיקי שימוש במוצר חדש אם מתפתח גירוי.',
};

// Valid app wire shape with a complete AM/PM SR routine. The unmatched protect slot is
// intentional: it must survive mapping and replace no generic sunscreen guidance.
function bedrockResponse(language = 'en') {
  const hebrew = language === 'he';
  const words = hebrew
    ? { summary: 'התשובות מצביעות על צורך בשגרה עדינה.', cleanser: 'ניקוי עדין', moisturizer: 'קרם לחות', sunscreen: 'הגנה מהשמש', useSpf: 'השתמשי במסנן קרינה רחב טווח SPF 30 ומעלה בכל בוקר.' }
    : { summary: 'Your answers support a simple, gentle routine.', cleanser: 'Gentle cleanser', moisturizer: 'Moisturizer', sunscreen: 'Sunscreen', useSpf: 'Use a broad-spectrum SPF 30 or higher each morning.' };
  const productId = '64b000000000000000000001';
  const srStep = (step, category_id, routine_category, matched) => ({
    step, category_id, routine_category,
    sr_product_id: matched ? productId : null,
    sr_product_name: matched ? (category_id === 'cleanse' ? words.cleanser : words.moisturizer) : '',
    key_actives_matched: [],
    use_instruction: matched ? 'Use as directed.' : '',
    match_reason: matched ? 'A suitable home-care match.' : '',
    no_match_note: matched ? '' : words.useSpf,
  });
  return {
    era: {
      era: { id: 'barrier_healing', affirmation: hebrew ? 'טפלי בעור שלך בעדינות.' : 'Care for your skin gently.' },
      skin_analysis: { summary: words.summary, key_insights: [] },
      routine: {
        am: [
          { category_id: 'cleanse', category: words.cleanser, instruction: 'Cleanse gently.' },
          { category_id: 'moisturize', category: words.moisturizer, instruction: 'Apply moisturizer.' },
          { category_id: 'protect', category: words.sunscreen, instruction: words.useSpf },
        ],
        pm: [
          { category_id: 'cleanse', category: words.cleanser, instruction: 'Cleanse gently.' },
          { category_id: 'moisturize', category: words.moisturizer, instruction: 'Apply moisturizer.' },
        ],
      },
      product_audit: {
        current_products_assessment: [{
          product_type: 'moisturizer', verdict: 'missing', note: 'Add a gentle moisturizer.',
          suggested_replacement: null, suggested_replacement_product_id: null,
        }],
        most_urgent_gap: 'moisturizer',
      },
      check_in_prompts: [], safety_flags: [SAFETY_TEXT[language]], event_prep: null,
    },
    srProducts: {
      bundle_note: '',
      era_hero_product: { sr_product_id: productId, sr_product_name: words.moisturizer, hero_reason: words.summary },
      am: [srStep(1, 'cleanse', words.cleanser, true), srStep(2, 'moisturize', words.moisturizer, true), srStep(3, 'protect', words.sunscreen, false)],
      pm: [srStep(1, 'cleanse', words.cleanser, true), srStep(2, 'moisturize', words.moisturizer, true)],
    },
    shelfAnalysis: null,
    source: 'bedrock',
  };
}

async function interceptAnalysis(page, results) {
  const calls = [];
  await page.route(ANALYZE_URL, async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (request.method() !== 'POST') return route.fulfill({ status: 405, headers: CORS });
    calls.push({
      body: request.postDataJSON(),
      authorization: request.headers().authorization || null,
    });
    const next = results.shift() || { status: 500, body: { error: 'No mocked analysis result remains.' } };
    if (next.error) return route.abort(next.error);
    return route.fulfill({ status: next.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(next.body) });
  });
  return calls;
}

// Signup lands directly on SkinTiming, unlike the older helper which starts at Profile's CTA.
async function finishSignupOnboarding(page, t) {
  await expect(page.getByText(t('onboarding:timing.headline'))).toBeVisible();
  await page.getByText(t('onboarding:timing.night')).click();
  await page.getByText(t('onboarding:timing.cta')).click();
  await expect(page.getByText(t('onboarding:selfie.title'))).toBeVisible();
  await page.getByText(t('onboarding:selfie.cta')).click();
  await expect(page.getByText(t('onboarding:shelf.title'))).toBeVisible();
  await page.getByText(t('onboarding:shelf.skip')).click();
  await expect(page.getByText(t('onboarding:notifications.title'))).toBeVisible();
  await page.getByText(t('onboarding:notifications.ctaLater')).click();
  await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
}

test.setTimeout(180_000);

test.describe('successful pre-signup Bedrock analysis', () => {
  test('uses the public analysis route, preserves source and unmatched SPF through Home', async ({ page, mock, t }) => {
    const calls = await interceptAnalysis(page, [{ status: 200, body: bedrockResponse('en') }]);
    await page.goto('/');
    await walkQuizToLoading(page, t);

    await expect.poll(() => calls.length, { timeout: 10_000 }).toBe(1);
    await expect(page.getByText('Barrier Healing Era', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(t('home:fallbackBanner.title'), { exact: true })).toHaveCount(0);
    expect(calls[0].authorization).toBeNull();
    expect(calls[0].body.language).toBe('en');
    expect(calls[0].body.quizAnswers).toBeTruthy();
    expect(Array.isArray(calls[0].body.images)).toBe(true);
    expect(mock.callsTo('POST', '/api/analysis')).toHaveLength(0); // still a visitor, not signed up yet

    await page.getByText(t('profile:cta'), { exact: true }).click();
    await page.getByPlaceholder(t('auth:signup.emailPlaceholder')).fill('dana@example.test');
    await page.getByPlaceholder(t('auth:signup.passwordPlaceholder')).fill('password123');
    await page.getByText(t('auth:signup.ctaAfterQuiz'), { exact: true }).click();
    await expect(page.getByText(t('onboarding:timing.headline'))).toBeVisible();
    await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(1);
    expect(mock.lastCall('POST', '/api/analysis').body.source).toBe('bedrock');

    await finishSignupOnboarding(page, t);
    await openProfileFromHome(page, t);
    await expect(page.getByText(SAFETY_TEXT.en, { exact: false })).toBeVisible();
    await expect.poll(() => mock.callsTo('POST', '/api/ai/product-recommendations').length).toBe(1);
    const recRequest = mock.lastCall('POST', '/api/ai/product-recommendations').body;
    expect(recRequest.language).toBe('en');
    expect(recRequest.safetyContext).toMatchObject({
      pregnant_or_ttc: 'no',
      allergies: ['none'],
      irritants: ['sun', 'heat'],
    });
    expect(recRequest.safetyContext).not.toHaveProperty('name');
    expect(recRequest.safetyContext).not.toHaveProperty('birthday');
    await openHome(page, t);
    await page.getByText(t('home:tabs.am'), { exact: true }).click();
    await expect(page.getByText('Sunscreen', { exact: true })).toBeVisible();
    await expect(page.getByText(bedrockResponse('en').srProducts.am[2].no_match_note, { exact: true })).toBeVisible();
  });

  test('skipped hormone answers are omitted while the generic Bedrock SPF guidance renders', async ({ page, mock, t }) => {
    const calls = await interceptAnalysis(page, [{ status: 200, body: bedrockResponse('en') }]);
    await page.goto('/');
    await walkQuizToLoading(page, t, { skipHormones: true });

    await expect.poll(() => calls.length, { timeout: 10_000 }).toBe(1);
    const quizAnswers = calls[0].body.quizAnswers;
    expect(quizAnswers).not.toHaveProperty('pregnant_or_ttc');
    expect(quizAnswers).not.toHaveProperty('pregnancy_caution');
    expect(quizAnswers).not.toHaveProperty('hormones');
    await expect(page.getByText('Barrier Healing Era', { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByText(t('profile:cta'), { exact: true }).click();
    await page.getByPlaceholder(t('auth:signup.emailPlaceholder')).fill('dana-skipped-hormones@example.test');
    await page.getByPlaceholder(t('auth:signup.passwordPlaceholder')).fill('password123');
    await page.getByText(t('auth:signup.ctaAfterQuiz'), { exact: true }).click();
    await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(1);
    await finishSignupOnboarding(page, t);
    await page.getByText(t('home:tabs.am'), { exact: true }).click();
    await expect(page.getByText('Sunscreen', { exact: true })).toBeVisible();
    await expect(page.getByText(bedrockResponse('en').srProducts.am[2].no_match_note, { exact: true })).toBeVisible();
  });
});

test.describe('reopened analysis safety context', () => {
  test.use({ signedIn: true });

  test('uses minimized safety fields from the persisted quiz snapshot', async ({ page, mock, t }) => {
    mock.set({ analysis: {
      ...ANALYSIS,
      quizAnswers: {
        gender: 'she', pregnant_or_ttc: 'yes', allergies: ['fragrance'], allergies_other: 'latex',
        irritants: ['retinoids'], irritants_other: 'peppermint', health_conditions: ['diabetes'],
        diagnosed_conditions: ['eczema'], name: 'Private Name', birthday: '1/1/1990', city: 'Private City',
      },
    } });
    await openHome(page, t);
    await openProfileFromHome(page, t);
    await expect.poll(() => mock.callsTo('POST', '/api/ai/product-recommendations').length).toBe(1);
    const body = mock.lastCall('POST', '/api/ai/product-recommendations').body;
    expect(body.safetyContext).toMatchObject({
      pregnant_or_ttc: 'yes', allergies: ['fragrance'], allergies_other: 'latex',
      irritants: ['retinoids'], health_conditions: ['diabetes'], diagnosed_conditions: ['eczema'],
    });
    expect(body.safetyContext).not.toHaveProperty('name');
    expect(body.safetyContext).not.toHaveProperty('birthday');
    expect(body.safetyContext).not.toHaveProperty('city');
  });
});

test.describe('interactive fallback retry', () => {
  test.use({ signedIn: true });

  test('retries the backend route and replaces the fallback with Bedrock source', async ({ page, mock, t }) => {
    mock.set({ analysis: null, user: FIRST_TIME_USER });
    const calls = await interceptAnalysis(page, [
      { status: 503, body: { error: 'The analysis service is unavailable.' } },
      { status: 200, body: bedrockResponse('en') },
    ]);
    await page.goto('/');
    await walkQuizToLoading(page, t);
    await expect(page.getByText(t('home:fallbackBanner.title'), { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => calls.length, { timeout: 10_000 }).toBe(1);

    await page.getByText(t('common:tryAgain'), { exact: true }).click();
    await expect(page.getByText(t('quiz:loading.subtitle'))).toBeVisible();
    await expect.poll(() => calls.length, { timeout: 10_000 }).toBe(2);
    await expect(page.getByText('Barrier Healing Era', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(t('home:fallbackBanner.title'), { exact: true })).toHaveCount(0);
    expect(calls[0].body.language).toBe('en');
    expect(calls[1].body.language).toBe('en');
    await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(2);
    expect(mock.callsTo('POST', '/api/analysis').map(call => call.body.source)).toEqual(['fallback', 'bedrock']);
  });
});

test.describe('analysis transport failure', () => {
  test('a timed-out provider connection reaches the existing generic fallback', async ({ page, t }) => {
    const calls = await interceptAnalysis(page, [{ error: 'timedout' }]);
    await page.goto('/');
    await walkQuizToLoading(page, t);
    await expect.poll(() => calls.length, { timeout: 10_000 }).toBe(1);
    await expect(page.getByText(t('home:fallbackBanner.title'), { exact: true })).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('Hebrew Bedrock safety copy', () => {
  test.use({ lang: 'he' });

  test('sends Hebrew as the analysis language and displays the returned safety flag in RTL', async ({ page, t }) => {
    const calls = await interceptAnalysis(page, [{ status: 200, body: bedrockResponse('he') }]);
    await page.goto('/');
    await walkQuizToLoading(page, t);
    await expect.poll(() => calls.length, { timeout: 10_000 }).toBe(1);
    expect(calls[0].body.language).toBe('he');
    await page.getByText(t('profile:cta'), { exact: true }).click();
    await page.getByPlaceholder(t('auth:signup.emailPlaceholder')).fill('dana-he@example.test');
    await page.getByPlaceholder(t('auth:signup.passwordPlaceholder')).fill('password123');
    await page.getByText(t('auth:signup.ctaAfterQuiz'), { exact: true }).click();
    await finishSignupOnboarding(page, t);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await openProfileFromHome(page, t);
    await expect(page.getByText(SAFETY_TEXT.he, { exact: false })).toBeVisible({ timeout: 30_000 });
  });
});

// This saved-analysis fixture isolates Home's display contract from model quality. The AM
// product routine contains an unmatched protect step, which must render instead of disappearing.
test.describe('unmatched Bedrock sunscreen step', () => {
  test.use({ signedIn: true });

  test('Home displays the unmatched SPF slot and its safe-use instruction', async ({ page, mock, t }) => {
    const analysis = {
      ...ANALYSIS,
      source: 'bedrock',
      safetyFlags: [SAFETY_TEXT.en],
      srProducts: bedrockResponse('en').srProducts,
    };
    mock.set({ analysis });
    await openHome(page, t);
    await expect(page.getByText('Sunscreen', { exact: true })).toBeVisible();
    await expect(page.getByText(bedrockResponse('en').srProducts.am[2].no_match_note, { exact: true })).toBeVisible();
  });
});
