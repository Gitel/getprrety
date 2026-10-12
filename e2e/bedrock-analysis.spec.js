// Bedrock client contract checks. API traffic is intercepted per test so these exercises never
// call a provider or real backend; the only saved-analysis POSTs go through the existing mock.
import { createServer } from 'node:http';
import { test, expect } from './support/test.js';
import { ANALYSIS, FIRST_TIME_USER } from './support/fixtures-data.js';
import { walkQuizToLoading } from './support/quiz.js';
import { openHome, openProfileFromHome } from './support/nav.js';
import compactHelper from '../tools/bedrock-eval/opus46-compact.cjs';

const { hydrateCompactOutput } = compactHelper;

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

// The server hydrates compact model output before returning canonical fields to the client.
function hydratedCompactBedrockResponse() {
  const canonical = bedrockResponse('en');
  const productId = canonical.srProducts.era_hero_product.sr_product_id;
  const productName = 'Hydrated Calm Cream';
  canonical.srProducts.era_hero_product.sr_product_name = productName;
  for (const period of ['am', 'pm']) for (const step of canonical.srProducts[period]) {
    if (step.sr_product_id) step.sr_product_name = productName;
  }
  canonical.shelfAnalysis = {
    identified_products: [{ status: 'compatible', brand: 'Photo Brand', product_name: 'Photo Cream',
      category: 'face_creams', status_reason: 'The visible product appears compatible.',
      use_instruction: 'Use as directed.', sr_substitute_name: productName, sr_substitute_product_id: productId }],
    shelf_summary: { overall_note: 'One photographed product was reviewed.' },
    transition_plan: { first_sr_purchase: productName, first_sr_purchase_product_id: productId },
  };
  const compact = structuredClone(canonical);
  for (const item of compact.era.product_audit.current_products_assessment) delete item.suggested_replacement;
  delete compact.srProducts.era_hero_product.sr_product_name;
  for (const period of ['am', 'pm']) for (const step of compact.srProducts[period]) {
    delete step.step;
    delete step.sr_product_name;
    step.explanation = step.sr_product_id ? step.match_reason : step.no_match_note;
    delete step.match_reason;
    delete step.no_match_note;
  }
  for (const item of compact.shelfAnalysis.identified_products) delete item.sr_substitute_name;
  delete compact.shelfAnalysis.transition_plan.first_sr_purchase;
  return hydrateCompactOutput(compact, { eligibleProducts: [{ _id: productId, name: productName }] });
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

// A tiny local HTTP endpoint lets these tests hold an actual event stream between progress
// updates. Playwright's route.fulfill buffers a whole response, which cannot prove incremental UI.
async function createControlledAnalysisStream() {
  const waitingRequests = [];
  const requestWaiters = [];
  const requests = [];
  const server = createServer((request, response) => {
    const requestMeta = {
      method: request.method,
      url: request.url,
      origin: request.headers.origin || null,
      requestedMethod: request.headers['access-control-request-method'] || null,
      requestedHeaders: request.headers['access-control-request-headers'] || null,
    };
    requests.push(requestMeta);
    request.resume();
    // WebKit can preflight the rewritten loopback URL separately from the original API route.
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        ...CORS,
        'Access-Control-Allow-Origin': request.headers.origin || '*',
        'Access-Control-Allow-Headers': request.headers['access-control-request-headers'] || CORS['Access-Control-Allow-Headers'],
      }).end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/api/ai/analyze-skin') {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, {
      ...CORS,
      'Access-Control-Allow-Origin': request.headers.origin || '*',
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const stream = {
      requestHeaders: request.headers,
      send(event, data) { response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); },
      end() { response.end(); },
    };
    const waiter = requestWaiters.shift();
    if (waiter) waiter(stream);
    else waitingRequests.push(stream);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/api/ai/analyze-skin`,
    get requests() { return requests.map(item => ({ ...item })); },
    nextRequest() {
      const queued = waitingRequests.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        let waiter;
        const timeout = setTimeout(() => {
          const index = requestWaiters.indexOf(waiter);
          if (index !== -1) requestWaiters.splice(index, 1);
          reject(new Error('The browser did not open the streaming analysis request within 10 seconds'));
        }, 10_000);
        waiter = stream => {
          clearTimeout(timeout);
          resolve(stream);
        };
        requestWaiters.push(waiter);
      });
    },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function routeAnalysisToLocalStream(page, streamServer) {
  await page.route(ANALYZE_URL, route => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS });
    }
    return route.continue({ url: streamServer.url });
  });
}

function progressEvent(phase, requestId = 'e2e-stream-request') {
  return { requestId, phase };
}

const STREAM_REQUEST_IDS = {
  initial: '11111111-1111-4111-8111-111111111111',
  retry: '22222222-2222-4222-8222-222222222222',
  hebrew: '33333333-3333-4333-8333-333333333333',
};

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
    const calls = await interceptAnalysis(page, [{ status: 200, body: hydratedCompactBedrockResponse() }]);
    await page.goto('/');
    await walkQuizToLoading(page, t);

    await expect.poll(() => calls.length, { timeout: 10_000 }).toBe(1);
    await expect(page.getByText('Barrier Healing Era', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(t('home:fallbackBanner.title'), { exact: true })).toHaveCount(0);
    await expect(page.getByText(SAFETY_TEXT.en, { exact: false })).toBeVisible();
    await expect(page.getByText('Photo Cream', { exact: false })).toBeVisible();
    await expect(page.getByText('Hydrated Calm Cream', { exact: false }).first()).toBeVisible();
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

test.describe('incremental Bedrock analysis stream', () => {
  test('shows progress as it arrives and reveals the validated result only after complete', async ({ page, mock, t }) => {
    const streamServer = await createControlledAnalysisStream();
    try {
      await routeAnalysisToLocalStream(page, streamServer);
      await page.goto('/');
      await walkQuizToLoading(page, t);
      const stream = await streamServer.nextRequest();

      expect(stream.requestHeaders.accept).toContain('text/event-stream');
      stream.send('progress', progressEvent('waiting', STREAM_REQUEST_IDS.initial));
      await expect(page.getByText(t('quiz:loading.analysisProgress.waiting'), { exact: true })).toBeVisible();
      stream.send('progress', progressEvent('generating', STREAM_REQUEST_IDS.initial));
      await expect(page.getByText(t('quiz:loading.analysisProgress.generating'), { exact: true })).toBeVisible();
      await expect(page.getByText('Barrier Healing Era', { exact: true })).toHaveCount(0);
      expect(mock.callsTo('POST', '/api/analysis')).toHaveLength(0);

      stream.send('progress', progressEvent('validating', STREAM_REQUEST_IDS.initial));
      await expect(page.getByText(t('quiz:loading.analysisProgress.validating'), { exact: true })).toBeVisible();
      stream.send('complete', { requestId: STREAM_REQUEST_IDS.initial, analysis: bedrockResponse('en') });
      await expect(page.getByText('Barrier Healing Era', { exact: true })).toHaveCount(0);
      expect(mock.callsTo('POST', '/api/analysis')).toHaveLength(0);
      stream.end();
      await expect(page.getByText('Barrier Healing Era', { exact: true })).toBeVisible({ timeout: 30_000 });
      expect(mock.callsTo('POST', '/api/analysis')).toHaveLength(0); // A visitor result is not persisted before signup.
    } finally {
      await streamServer.close();
    }
  });
});

// A failed stream must return control to the existing retry affordance; only a completed retry
// replaces the persisted fallback analysis with a Bedrock result.
test.describe('stream failure and manual retry', () => {
  test.use({ signedIn: true });

  test('shows the fallback after a stream error and accepts a successful retry', async ({ page, mock, t }) => {
    mock.set({ analysis: null, user: FIRST_TIME_USER });
    const streamServer = await createControlledAnalysisStream();
    try {
      await routeAnalysisToLocalStream(page, streamServer);
      await page.goto('/');
      await walkQuizToLoading(page, t);
      const failedStream = await streamServer.nextRequest();
      failedStream.send('error', {
        requestId: STREAM_REQUEST_IDS.initial,
        error: 'The analysis service is temporarily unavailable.',
        status: 503,
        code: 'analysis_unavailable',
      });
      failedStream.end();
      await expect(page.getByText(t('home:fallbackBanner.title'), { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(1);

      await page.getByText(t('common:tryAgain'), { exact: true }).click();
      await expect(page.getByText(t('quiz:loading.subtitle'))).toBeVisible();
      const retryRequest = streamServer.nextRequest();
      const retryStream = await retryRequest;
      retryStream.send('progress', progressEvent('generating', STREAM_REQUEST_IDS.retry));
      await expect(page.getByText(t('quiz:loading.analysisProgress.generating'), { exact: true })).toBeVisible();
      await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(1);

      retryStream.send('complete', { requestId: STREAM_REQUEST_IDS.retry, analysis: bedrockResponse('en') });
      await expect(page.getByText('Barrier Healing Era', { exact: true })).toHaveCount(0);
      await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(1);
      retryStream.end();
      await expect(page.getByText('Barrier Healing Era', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(t('home:fallbackBanner.title'), { exact: true })).toHaveCount(0);
      await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(2);
      expect(mock.callsTo('POST', '/api/analysis').map(call => call.body.source)).toEqual(['fallback', 'bedrock']);
    } finally {
      await streamServer.close();
    }
  });
});

test.describe('Hebrew analysis stream progress', () => {
  test.use({ lang: 'he' });

  test('localizes progress labels while the Hebrew result is still held', async ({ page, t }) => {
    const streamServer = await createControlledAnalysisStream();
    const translatedEraName = t('eras:barrier_healing.name');
    try {
      await routeAnalysisToLocalStream(page, streamServer);
      await page.goto('/');
      await walkQuizToLoading(page, t);
      const stream = await streamServer.nextRequest();

      stream.send('progress', progressEvent('waiting', STREAM_REQUEST_IDS.hebrew));
      await expect(page.getByText(t('quiz:loading.analysisProgress.waiting'), { exact: true })).toBeVisible();
      stream.send('progress', progressEvent('generating', STREAM_REQUEST_IDS.hebrew));
      await expect(page.getByText(t('quiz:loading.analysisProgress.generating'), { exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByText(translatedEraName, { exact: true })).toHaveCount(0);

      stream.send('complete', { requestId: STREAM_REQUEST_IDS.hebrew, analysis: bedrockResponse('he') });
      await expect(page.getByText(translatedEraName, { exact: true })).toHaveCount(0);
      stream.end();
      await expect(page.getByText(translatedEraName, { exact: true })).toBeVisible({ timeout: 30_000 });
    } finally {
      await streamServer.close();
    }
  });
});
