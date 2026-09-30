// Baseline for the quiz + onboarding chain (T-B2): Login "Skip for now" -> QuizIntro -> Quiz
// (every question type) -> Loading -> Profile -> SignUp / SkinTiming -> SkinSelfie ->
// ShelfPhotos -> Notifications -> Home.
//
// These tests lock in what the app does TODAY. The analysis service (Railway) answers 503 by
// default, so after the quiz the app shows its built-in fallback plan with the fallback banner.
import { test, expect } from './support/test.js';
import { USER } from './support/fixtures-data.js';

// The quiz has timed screens (greeting 2 s, four chapter interstitials 2.2 s each, Loading about
// 5 s), so a full walk takes 25-40 s. Give every test plenty of room.
test.setTimeout(180_000);

// The name typed in the quiz. The app wraps the name in Unicode isolates (U+2068 / U+2069)
// inside quiz texts, so texts that contain {{name}} must be built with the same wrapper.
const NAME = 'Dana';
const NAME_VARS = { name: '⁨' + NAME + '⁩' };

// ---- helpers ---------------------------------------------------------------------------------

// Exact-text locator (getByText is a "contains" match by default, which would also match
// "Continue" inside longer texts).
const text = (page, value) => page.getByText(value, { exact: true });

// Same CORS headers as e2e/support/mock-api.js (Authorization must be listed by name).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

// Makes the signed-in user a FIRST-TIME user: no saved analysis (so the app opens on QuizIntro)
// and no skincareTiming (so the Profile call-to-action leads to the onboarding chain instead of
// Home). The shared mock user has skincareTiming 'morning', hence this local override of
// GET /api/auth/me (a page route wins over the context router of the mock).
async function makeFirstTimeUser(page, mock) {
  mock.set({ analysis: null });
  const { skincareTiming, ...firstTimeUser } = USER; // same user, minus skincareTiming
  await page.route('http://api.e2e.test/api/auth/me', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({
      status: 200, headers: CORS, contentType: 'application/json',
      body: JSON.stringify({ user: firstTimeUser }),
    });
  });
}

// Signed-out entry: Login -> "Skip for now" (accepts the terms) -> QuizIntro.
async function skipLoginToQuizIntro(page, t) {
  await page.goto('/');
  await text(page, t('auth:login.skip')).click();
  await expect(text(page, t('quiz:welcome.cta'))).toBeVisible();
}

// Walks the WHOLE quiz, starting on QuizIntro and ending on the Loading screen.
// Every question type is used once:
//   name (text), greeting + chapter interstitials (auto-advance timers), birthday (wheel picker,
//   default date), gender (cards), location (city search), single, multi (flat chips), tone,
//   multi with groups, priority (top concern), hormones, slider, event, event date,
//   photos (skipped), shelf (skipped), completion.
// Each step first waits for its own question text, so it never clicks on the previous screen.
async function walkQuizToLoading(page, t) {
  const q = id => text(page, t(`quiz:${id}.question`, NAME_VARS));
  const opt = (id, value) => text(page, t(`quiz:${id}.options.${value}.label`));
  const cta = key => text(page, t(`quiz:ui.${key}`));

  // QuizIntro -> first question
  await text(page, t('quiz:welcome.cta')).click();

  // name: text input. Its CTA is always enabled.
  await expect(q('name')).toBeVisible();
  await page.getByPlaceholder(t('quiz:name.placeholder')).fill(NAME);
  await cta('continue').click();

  // greeting: shows the name and moves on by itself after 2 s (real app timer).
  await expect(text(page, t('quiz:greeting.text', NAME_VARS))).toBeVisible();

  // birthday: the wheel picker already holds a default date, so Continue is enabled at once.
  await expect(q('birthday')).toBeVisible({ timeout: 10_000 });
  await cta('continue').click();

  // gender: descriptive cards, the CTA says "Next".
  await expect(q('gender')).toBeVisible();
  await opt('gender', 'she').click();
  await cta('next').click();

  // location: type a prefix, pick a suggestion from the (mocked) city search.
  await expect(q('location')).toBeVisible();
  await page.getByPlaceholder(t('quiz:location.input.placeholder')).fill('Tel');
  await text(page, 'Tel Aviv, Israel').click(); // fixture city
  await cta('continue').click();

  // single choice
  await expect(q('work_environment')).toBeVisible();
  await opt('work_environment', 'office').click();
  await cta('continue').click();

  // chapter interstitial: auto-advances after 2.2 s.
  await expect(text(page, t('quiz:chapter_2.headline'))).toBeVisible();

  // multi choice (flat chips): two picks
  await expect(q('interests')).toBeVisible({ timeout: 10_000 });
  await opt('interests', 'routine_that_works').click();
  await opt('interests', 'track_progress').click();
  await cta('continue').click();

  // skin tone grid
  await expect(q('tone')).toBeVisible();
  await opt('tone', 'III').click();
  await cta('continue').click();

  await expect(q('post_cleanse_feel')).toBeVisible();
  await opt('post_cleanse_feel', 'dry').click();
  await cta('continue').click();

  await expect(q('irritants')).toBeVisible();
  await opt('irritants', 'sun').click();
  await opt('irritants', 'heat').click();
  await cta('continue').click();

  // multi choice with groups (the CTA says "Next"). Two goals -> the "top concern" question shows.
  await expect(q('skin_goals')).toBeVisible();
  await opt('skin_goals', 'acne').click();
  await opt('skin_goals', 'redness').click();
  await cta('next').click();

  // priority: lists ONLY the goals chosen before.
  await expect(q('top_concern')).toBeVisible();
  await expect(opt('skin_goals', 'redness')).toBeVisible();
  await expect(opt('skin_goals', 'wrinkles')).toHaveCount(0);
  await opt('skin_goals', 'acne').click();
  await cta('next').click();

  await expect(text(page, t('quiz:chapter_3.headline'))).toBeVisible();

  // "None" options are exclusive; each of these three questions needs one pick to continue.
  await expect(q('diagnosed_conditions')).toBeVisible({ timeout: 10_000 });
  await opt('diagnosed_conditions', 'none').click();
  await cta('continue').click();

  await expect(q('health_conditions')).toBeVisible();
  await opt('health_conditions', 'none').click();
  await cta('continue').click();

  await expect(q('allergies')).toBeVisible();
  await text(page, t('quiz:allergies.extraOptions.none.label')).click();
  await cta('next').click();

  // hormones: only asked when gender is "she". Its CTA is always enabled; pick one chip anyway
  // (every field has a "No" chip, so take the first one).
  await expect(q('hormones')).toBeVisible();
  await text(page, t('quiz:hormones.fields.pregnant.options.no.label')).first().click();
  await cta('continue').click();

  await expect(text(page, t('quiz:chapter_4.headline'))).toBeVisible();

  await expect(q('sleep')).toBeVisible({ timeout: 10_000 });
  await opt('sleep', '7_8').click();
  await cta('continue').click();

  // slider 1-10: tapping a number shows its label under the row.
  await expect(q('stress')).toBeVisible();
  await text(page, '7').click();
  await expect(text(page, t('quiz:stress.labels.7'))).toBeVisible();
  await cta('continue').click();

  await expect(q('water_intake')).toBeVisible();
  await opt('water_intake', '1_5_2l').click();
  await cta('continue').click();

  await expect(q('alcohol')).toBeVisible();
  await opt('alcohol', 'never').click();
  await cta('continue').click();

  await expect(q('smoke')).toBeVisible();
  await opt('smoke', 'never').click();
  await cta('continue').click();

  await expect(q('exercise')).toBeVisible();
  await opt('exercise', '3_5_week').click();
  await cta('continue').click();

  await expect(text(page, t('quiz:chapter_5.headline'))).toBeVisible();

  await expect(q('routine_products')).toBeVisible({ timeout: 10_000 });
  await opt('routine_products', 'cleanser').click();
  await opt('routine_products', 'moisturizer').click();
  await cta('continue').click();

  // event: any event except "no event" adds the event-date question.
  await expect(q('event')).toBeVisible();
  await opt('event', 'wedding').click();
  await cta('continue').click();

  await expect(q('event_date')).toBeVisible();
  await cta('continue').click();

  // photos: optional. With no photo the button says "Skip for now".
  await expect(q('photos')).toBeVisible();
  await cta('skipForNow').click();

  // shelf photos: optional as well.
  await expect(q('shelf')).toBeVisible();
  await cta('skipForNow').click();

  // completion card -> the analysis starts on the Loading screen.
  await expect(text(page, t('quiz:completion.headline', NAME_VARS))).toBeVisible();
  await cta('seeEra').click();
  await expect(text(page, t('quiz:loading.subtitle'))).toBeVisible();
}

// The Profile screen right after the quiz, showing the built-in fallback plan.
async function expectProfileAfterQuiz(page, t) {
  await expect(text(page, t('home:fallbackBanner.title'))).toBeVisible({ timeout: 30_000 });
  await expect(text(page, t('profile:cta'))).toBeVisible();
  // Answers are still in memory, so the banner offers "Try again" (not "Retake assessment").
  await expect(text(page, t('common:tryAgain'))).toBeVisible();
}

// The Back button (identical text on every screen that has one).
const backButton = (page, t) => text(page, t('common:back'));

// ---- tests -----------------------------------------------------------------------------------

test.describe('signed out (anonymous "Skip for now" path)', () => {
  test('QuizIntro Back pops one screen to Login; the Quiz screen has no Back control', async ({ page, t }) => {
    await skipLoginToQuizIntro(page, t);

    // QuizIntro was opened on top of Login, so it shows Back; one press returns to Login.
    await backButton(page, t).click();
    await expect(text(page, t('auth:login.cta'))).toBeVisible();
    await expect(text(page, t('quiz:welcome.cta'))).toHaveCount(0);

    // Go in again and start the quiz: the first question has no Back control.
    await text(page, t('auth:login.skip')).click();
    await text(page, t('quiz:welcome.cta')).click();
    await expect(text(page, t('quiz:name.question'))).toBeVisible();
    await expect(backButton(page, t)).toHaveCount(0);
  });

  test('SignUp opened from Login: Back pops one screen to Login', async ({ page, t }) => {
    await page.goto('/');
    await text(page, t('auth:login.createAccount')).click();
    await expect(text(page, t('auth:signup.headline'))).toBeVisible();

    await backButton(page, t).click();
    await expect(text(page, t('auth:login.cta'))).toBeVisible();
    await expect(text(page, t('auth:signup.headline'))).toHaveCount(0);
  });

  test('full quiz -> Loading -> Profile with fallback banner -> SignUp (Back returns to Profile) -> account created -> onboarding', async ({ page, mock, t }) => {
    await skipLoginToQuizIntro(page, t);
    await walkQuizToLoading(page, t);

    // Loading has no Back control.
    await expect(backButton(page, t)).toHaveCount(0);

    // Railway answers 503 -> the app builds the fallback plan and shows the banner on Profile.
    await expectProfileAfterQuiz(page, t);

    // Nobody is signed in, so nothing is saved yet.
    expect(mock.callsTo('POST', '/api/analysis')).toHaveLength(0);

    // Profile call-to-action, signed out -> SignUp (the after-quiz variant of the button).
    await text(page, t('profile:cta')).click();
    await expect(text(page, t('auth:signup.ctaAfterQuiz'))).toBeVisible();

    // SignUp Back pops exactly one screen: Profile (not Loading, not Login).
    await backButton(page, t).click();
    await expectProfileAfterQuiz(page, t);
    await expect(text(page, t('auth:signup.ctaAfterQuiz'))).toHaveCount(0);

    // Sign up for real: the account is created, the analysis is saved ONCE, SkinTiming opens.
    await text(page, t('profile:cta')).click();
    await page.getByPlaceholder(t('auth:signup.emailPlaceholder')).fill('dana@example.test');
    await page.getByPlaceholder(t('auth:signup.passwordPlaceholder')).fill('password123');
    await text(page, t('auth:signup.ctaAfterQuiz')).click();
    await expect(text(page, t('onboarding:timing.headline'))).toBeVisible();

    expect(mock.callsTo('POST', '/api/auth/signup')).toHaveLength(1);
    expect(mock.lastCall('POST', '/api/auth/signup').body).toMatchObject({ email: 'dana@example.test' });
    await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(1);
    const saved = mock.lastCall('POST', '/api/analysis').body;
    expect(saved.quizAnswers).toMatchObject({ name: NAME, gender: 'she', top_concern: 'acne' });
    expect(saved.source).toBe('fallback');
  });
});

test.describe('signed in, first-time user (no analysis, no skincareTiming)', () => {
  test.use({ signedIn: true });

  test('holding the analysis keeps Loading on screen until it is released, then Profile', async ({ page, mock, t }) => {
    await makeFirstTimeUser(page, mock);
    mock.holdAnalysis(); // the analysis request now stays open

    await page.goto('/');
    // No analysis and a signed-in user -> the app opens on QuizIntro (no Back: nothing under it).
    await expect(text(page, t('quiz:welcome.cta'))).toBeVisible();
    await expect(backButton(page, t)).toHaveCount(0);

    await walkQuizToLoading(page, t);

    // The last loading stage stays "in progress" while the request is held.
    await expect(text(page, t('quiz:loading.inProgress'))).toBeVisible({ timeout: 15_000 });
    // Proving that something does NOT happen needs a real wait: the stages take 4.2 s to reach
    // the last one, so wait past that and check we are still on Loading.
    await page.waitForTimeout(6_000);
    await expect(text(page, t('quiz:loading.subtitle'))).toBeVisible();
    await expect(text(page, t('profile:cta'))).toHaveCount(0);
    await expect(backButton(page, t)).toHaveCount(0);
    // The result is not saved before the analysis finishes.
    expect(mock.callsTo('POST', '/api/analysis')).toHaveLength(0);

    await mock.releaseAnalysis();
    await expectProfileAfterQuiz(page, t);
    await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(1);
  });

  test('quiz -> Profile -> SkinTiming -> SkinSelfie -> ShelfPhotos -> Notifications -> Home; analysis saved once; Back buttons pop one screen', async ({ page, mock, t }) => {
    await makeFirstTimeUser(page, mock);

    await page.goto('/');
    await walkQuizToLoading(page, t);
    await expectProfileAfterQuiz(page, t);

    // The analysis is sent exactly once (by Loading, because the user is signed in), with the answers.
    await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(1);
    const saved = mock.lastCall('POST', '/api/analysis').body;
    expect(saved.quizAnswers).toMatchObject({
      name: NAME, gender: 'she', work_environment: 'office', tone: 'III', top_concern: 'acne',
      skin_goals: ['acne', 'redness'], stress: 7, event: 'wedding',
    });
    expect(saved.source).toBe('fallback');
    expect(saved.era).toBeTruthy();
    // No sign-up call: the user was already signed in.
    expect(mock.callsTo('POST', '/api/auth/signup')).toHaveLength(0);

    // Signed in but never answered SkinTiming -> the call-to-action starts the onboarding chain.
    await text(page, t('profile:cta')).click();
    await expect(text(page, t('onboarding:timing.headline'))).toBeVisible();

    // SkinTiming Back pops one screen: Profile. Then go forward again.
    await backButton(page, t).click();
    await expectProfileAfterQuiz(page, t);
    await text(page, t('profile:cta')).click();
    await expect(text(page, t('onboarding:timing.headline'))).toBeVisible();

    // "Let's go" needs a choice; it saves the choice and opens SkinSelfie.
    await text(page, t('onboarding:timing.night')).click();
    await text(page, t('onboarding:timing.cta')).click();
    await expect(text(page, t('onboarding:selfie.title'))).toBeVisible();
    expect(mock.lastCall('PATCH', '/api/profile').body).toEqual({ skincareTiming: 'night' });

    // SkinSelfie (web): no camera, just Continue. It has no Back control today.
    await expect(backButton(page, t)).toHaveCount(0);
    await text(page, t('onboarding:selfie.cta')).click();

    // ShelfPhotos: skip with no photo. It has no Back control today.
    await expect(text(page, t('onboarding:shelf.title'))).toBeVisible();
    await expect(backButton(page, t)).toHaveCount(0);
    await text(page, t('onboarding:shelf.skip')).click();

    // Notifications: Back pops one screen (ShelfPhotos); then forward again.
    await expect(text(page, t('onboarding:notifications.title'))).toBeVisible();
    await backButton(page, t).click();
    await expect(text(page, t('onboarding:shelf.title'))).toBeVisible();
    await expect(text(page, t('onboarding:notifications.title'))).toHaveCount(0);
    await text(page, t('onboarding:shelf.skip')).click();

    // Notifications are not granted on the web -> "Set up later" goes on to Home.
    await text(page, t('onboarding:notifications.ctaLater')).click();
    await expect(text(page, t('home:greeting.morning'))).toBeVisible();

    // Still exactly one analysis save after the whole chain.
    expect(mock.callsTo('POST', '/api/analysis')).toHaveLength(1);
  });
});
