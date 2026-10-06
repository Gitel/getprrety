// Shared quiz + onboarding helpers (moved from quiz-onboarding.spec.js).
import { expect } from './test.js';

// The name typed in the quiz. The app wraps the name in Unicode isolates (U+2068 / U+2069)
// inside quiz texts, so texts that contain {{name}} must be built with the same wrapper.
export const NAME = 'Dana';
export const nameVars = { name: String.fromCharCode(0x2068) + NAME + String.fromCharCode(0x2069) };

// Exact-text locator (getByText is a "contains" match by default, which would also match
// "Continue" inside longer texts).
const text = (page, value) => page.getByText(value, { exact: true });

// Walks the WHOLE quiz, starting on QuizIntro and ending on the Loading screen.
// Every question type is used once:
//   name (text), greeting + chapter interstitials (auto-advance timers), birthday (wheel picker,
//   default date), gender (cards), location (city search), single, multi (flat chips), tone,
//   multi with groups, priority (top concern), hormones, slider, event, event date,
//   photos (skipped), shelf (skipped), completion.
// Each step first waits for its own question text, so it never clicks on the previous screen.
export async function walkQuizToLoading(page, t) {
  const q = id => text(page, t(`quiz:${id}.question`, nameVars));
  const opt = (id, value) => text(page, t(`quiz:${id}.options.${value}.label`));
  const cta = key => text(page, t(`quiz:ui.${key}`));

  // QuizIntro -> first question
  await text(page, t('quiz:welcome.cta')).click();

  // name: text input. Its CTA is always enabled.
  await expect(q('name')).toBeVisible();
  await page.getByPlaceholder(t('quiz:name.placeholder')).fill(NAME);
  await cta('continue').click();

  // greeting: shows the name and moves on by itself after 2 s (real app timer).
  await expect(text(page, t('quiz:greeting.text', nameVars))).toBeVisible();

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
  await expect(text(page, t('quiz:completion.headline', nameVars))).toBeVisible();
  await cta('seeEra').click();
  await expect(text(page, t('quiz:loading.subtitle'))).toBeVisible();
}

// The Profile screen right after the quiz, showing the built-in fallback plan.
// The first view after the quiz is not "opened from Home", so it has no menu button and no Back.
export async function expectProfileAfterQuiz(page, t) {
  await expect(text(page, t('home:fallbackBanner.title'))).toBeVisible({ timeout: 30_000 });
  await expect(text(page, t('profile:cta'))).toBeVisible();
  // Answers are still in memory, so the banner offers "Try again" (not "Retake assessment").
  await expect(text(page, t('common:tryAgain'))).toBeVisible();
  await expect(page.getByRole('button', { name: t('menu:open'), exact: true })).toHaveCount(0);
  await expect(text(page, t('common:back'))).toHaveCount(0);
}

// From the Profile after the quiz (signed-in, first-time user) through the whole onboarding
// chain to Home: SkinTiming (pick "night") -> SkinSelfie -> ShelfPhotos (skip) -> Notifications
// ("Set up later", nothing is granted on the web) -> Home.
export async function finishOnboardingToHome(page, t) {
  await text(page, t('profile:cta')).click();
  await expect(text(page, t('onboarding:timing.headline'))).toBeVisible();
  await text(page, t('onboarding:timing.night')).click();
  await text(page, t('onboarding:timing.cta')).click();
  await expect(text(page, t('onboarding:selfie.title'))).toBeVisible();
  await text(page, t('onboarding:selfie.cta')).click();
  await expect(text(page, t('onboarding:shelf.title'))).toBeVisible();
  await text(page, t('onboarding:shelf.skip')).click();
  await expect(text(page, t('onboarding:notifications.title'))).toBeVisible();
  await text(page, t('onboarding:notifications.ctaLater')).click();
  await expect(text(page, t('home:greeting.morning'))).toBeVisible();
}
