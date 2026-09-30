// Baseline for the quiz + onboarding chain (T-B2): Login "Skip for now" -> QuizIntro -> Quiz
// (every question type) -> Loading -> Profile -> SignUp / SkinTiming -> SkinSelfie ->
// ShelfPhotos -> Notifications -> Home.
//
// These tests lock in what the app does TODAY. The analysis service (Railway) answers 503 by
// default, so after the quiz the app shows its built-in fallback plan with the fallback banner.
import { test, expect } from './support/test.js';
import { FIRST_TIME_USER } from './support/fixtures-data.js';
import { backButton } from './support/nav.js';
import { NAME, walkQuizToLoading, expectProfileAfterQuiz } from './support/quiz.js';

// The quiz has timed screens (greeting 2 s, four chapter interstitials 2.2 s each, Loading about
// 5 s), so a full walk takes 25-40 s. Give every test plenty of room.
test.setTimeout(180_000);

// ---- helpers ---------------------------------------------------------------------------------

// Exact-text locator (getByText is a "contains" match by default, which would also match
// "Continue" inside longer texts).
const text = (page, value) => page.getByText(value, { exact: true });

// Makes the signed-in user a FIRST-TIME user: no saved analysis (so the app opens on QuizIntro)
// and no skincareTiming (so the Profile call-to-action leads to the onboarding chain instead of
// Home). Uses the shared mock user override.
function makeFirstTimeUser(mock) {
  mock.set({ analysis: null, user: FIRST_TIME_USER });
}

// Signed-out entry: Login -> "Skip for now" (accepts the terms) -> QuizIntro.
async function skipLoginToQuizIntro(page, t) {
  await page.goto('/');
  await text(page, t('auth:login.skip')).click();
  await expect(text(page, t('quiz:welcome.cta'))).toBeVisible();
}


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
    // SkinTiming was opened with navigate() on top of SignUp, so Back returns to SignUp.
    await backButton(page, t).click();
    await expect(text(page, t('auth:signup.ctaAfterQuiz'))).toBeVisible();

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
    makeFirstTimeUser(mock);
    mock.holdAnalysis(); // the analysis request now stays open

    await page.goto('/');
    // No analysis and a signed-in user -> the app opens on QuizIntro (no Back: nothing under it).
    await expect(text(page, t('quiz:welcome.cta'))).toBeVisible();
    await expect(backButton(page, t)).toHaveCount(0);

    await walkQuizToLoading(page, t);

    // Anchor: the check mark (U+2713) is shown on every FINISHED stage. Loading has 4 stages,
    // 1.4 s each, so 3 check marks means the LAST stage is now active (the hold starts here).
    const checkMarks = text(page, String.fromCharCode(0x2713));
    await expect(checkMarks).toHaveCount(3, { timeout: 15_000 });
    // Proving that something does NOT happen needs a real wait. The 700 ms reveal only starts
    // after the request answers, so wait well past one stage length and check we are still held.
    await page.waitForTimeout(2_000);
    await expect(checkMarks).toHaveCount(3);
    await expect(text(page, t('quiz:loading.done'))).toHaveCount(0);
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
    makeFirstTimeUser(mock);

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
    // Home has the menu button and no Back control.
    await expect(page.getByRole('button', { name: t('menu:open'), exact: true })).toBeVisible();
    await expect(backButton(page, t)).toHaveCount(0);

    // Still exactly one analysis save after the whole chain.
    expect(mock.callsTo('POST', '/api/analysis')).toHaveLength(1);
  });
});
