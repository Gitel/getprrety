// Edge swipe-back (test-first: written BEFORE the feature exists).
//
// The rule being tested:
//   - A one-finger touch that STARTS within 24 px of the screen edge and drags toward the
//     screen's middle goes back one screen: left edge -> right in English (LTR), right edge ->
//     left in Hebrew (RTL).
//   - Release past 35% of the width, or a fast flick (> 0.5 px/ms and > 40 px), goes back.
//     Anything else springs back and stays.
//   - A drag that is not horizontal at first (vertical-first) is ignored.
//   - Works on every screen with a screen beneath it, except Loading, Quiz, and a screen that
//     has Loading directly beneath it (the first Profile after the quiz).
//   - Messages and Settings no longer have a Back text button.
//   - The open side menu is outside the swipe area: swiping while it is open does not go back.
//   - Without reduced motion the screen follows the finger with an inline translateX, which is
//     cleared 180 ms after release.
// Gestures come from support/touch.js (real CDP touches in Chromium, synthetic events in WebKit).
import { test, expect } from './support/test.js';
import { FIRST_TIME_USER } from './support/fixtures-data.js';
import {
  openHome, openProfileFromHome, openMessages, openSettings, openSignUp, openMenu, panelOf, backButton,
} from './support/nav.js';
import { walkQuizToLoading, expectProfileAfterQuiz, finishOnboardingToHome } from './support/quiz.js';
import {
  edgeSwipe, oppositeEdgeSwipe, swipe, touchStart, touchMove, touchEnd, dragAlong, edgeSwipePlan, VIEWPORT_WIDTH,
} from './support/touch.js';

const text = (page, value) => page.getByText(value, { exact: true });

// Screen checks (same recognisers the other specs use).
const homeShows = (page, t) => expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
const messagesShow = (page, t) => expect(text(page, t('messages:title'))).toBeVisible();

// Proving "nothing happened" needs a real wait: give a wrongly-fired swipe time to navigate
// (goBack is synchronous, so this is generous), then the caller asserts we are still here.
const settle = page => page.waitForTimeout(400);

// Every inline `transform: ...translateX(...)` under #root, as strings (empty list = none).
const inlineTranslates = page => page.evaluate(() =>
  [...document.querySelectorAll('#root *')]
    .map(el => el.style.transform)
    .filter(value => value && value.includes('translateX')));

// First number in "translateX(123px)" (negative allowed).
const pxOf = value => Number(/translateX\((-?[\d.]+)/.exec(value)[1]);

const LONG = Math.round(VIEWPORT_WIDTH * 0.6); // a drag clearly past the 35% threshold (234 px)

// ---- direction cases, both languages -------------------------------------------------------
for (const lang of ['en', 'he']) {
  test.describe(`edge swipe, ${lang === 'en' ? 'English (LTR)' : 'Hebrew (RTL)'}`, () => {
    test.use({ signedIn: true, lang });

    test('Messages has no Back control; the swipe returns to Home', async ({ page, t }) => {
      await openMessages(page, t);
      await expect(backButton(page, t)).toHaveCount(0);
      await edgeSwipe(page, { lang, dx: LONG });
      await homeShows(page, t);
      await expect(text(page, t('messages:title'))).toHaveCount(0);
    });

    test('Settings has no Back control; the swipe returns to Home', async ({ page, t }) => {
      await openSettings(page, t);
      await expect(backButton(page, t)).toHaveCount(0);
      await edgeSwipe(page, { lang, dx: LONG });
      await homeShows(page, t);
      await expect(text(page, t('settings:title'))).toHaveCount(0);
    });

    test('Profile opened from Home: the swipe returns to Home', async ({ page, t }) => {
      await openProfileFromHome(page, t);
      await edgeSwipe(page, { lang, dx: LONG });
      await homeShows(page, t);
      await expect(text(page, t('profile:audit.title'))).toHaveCount(0);
    });

    test('the opposite edge does nothing', async ({ page, t }) => {
      await openMessages(page, t);
      await oppositeEdgeSwipe(page, { lang, dx: LONG });
      await settle(page);
      await messagesShow(page, t);
    });

    test('a swipe starting about 100 px from the edge does nothing', async ({ page, t }) => {
      await openMessages(page, t);
      await edgeSwipe(page, { lang, dx: LONG, startInset: 100 });
      await settle(page);
      await messagesShow(page, t);
    });

    test('a short slow drag (60 px, 0.1 px/ms) springs back', async ({ page, t }) => {
      await openMessages(page, t);
      await edgeSwipe(page, { lang, dx: 60, steps: 10, stepDelayMs: 60 });
      await settle(page);
      await messagesShow(page, t);
    });

    test('a fast flick (90 px, 2 steps, no delay) goes back', async ({ page, t }) => {
      await openMessages(page, t);
      // 90 px is above the 40 px flick minimum but below 35% of 390 (136.5 px), so only the
      // speed can make this go back. Steps are sent back to back (no wait) for a genuine flick.
      await edgeSwipe(page, { lang, dx: 90, steps: 2, stepDelayMs: 0 });
      await homeShows(page, t);
    });

    test('a quick drag that stops before release springs back', async ({ page, t }) => {
      await openMessages(page, t);
      const { from, to } = edgeSwipePlan({ lang, dx: 100 });
      await touchStart(page, from);
      await dragAlong(page, from, to, { steps: 2, stepDelayMs: 0 }); // fast movement...
      await page.waitForTimeout(300); // ...then the finger rests, so its release speed is ~0
      await touchEnd(page, to);
      await settle(page);
      await messagesShow(page, t); // 100 px < 35% and no speed at release: stays
    });

    test('35% boundary: a slow 120 px drag stays, a slow 160 px drag goes back', async ({ page, t }) => {
      await openMessages(page, t);
      // 35% of 390 = 136.5 px. Both drags are slow (~0.2 to 0.27 px/ms), so only distance decides.
      await edgeSwipe(page, { lang, dx: 120, steps: 10, stepDelayMs: 60 });
      await settle(page);
      await messagesShow(page, t);
      await edgeSwipe(page, { lang, dx: 160, steps: 10, stepDelayMs: 60 });
      await homeShows(page, t);
    });

    test('reduced motion: the screen does not slide mid-drag, then a long release goes back', async ({ page, t }) => {
      await openMessages(page, t);
      // Reduced motion is ON by default (playwright.config.js contextOptions; guarded by a test in
      // smoke.spec.js), so no explicit emulateMedia is needed here.
      const { from, to } = edgeSwipePlan({ lang, dx: 100 });
      await touchStart(page, from);
      await dragAlong(page, from, to, { steps: 5, stepDelayMs: 16 }); // well past the slop, finger down
      // Reduced motion: nothing under #root may carry an inline translateX while dragging.
      expect(await inlineTranslates(page)).toEqual([]);
      const far = edgeSwipePlan({ lang, dx: LONG }).to;
      await dragAlong(page, to, far, { steps: 5, stepDelayMs: 16 }); // continue past 35%
      await touchEnd(page, far);
      await homeShows(page, t);
    });

    test('dragging toward the edge first, then the back way, does nothing', async ({ page, t }) => {
      await openMessages(page, t);
      // Start 20 px in from the correct edge, go 16 px TOWARD the edge (past the slop), then
      // 250 px the back way. The first decision was "not a back swipe", so the rest is ignored.
      // Geometry (width 390): en 20 -> 4 -> 254, he 370 -> 386 -> 136; all inside the viewport.
      const { from, to: edgeward } = edgeSwipePlan({ lang, dx: -16, startInset: 20 });
      // 250 px the back way from the edgeward point = 234 px from the start.
      const end = edgeSwipePlan({ lang, dx: 250 - 16, startInset: 20 }).to;
      await touchStart(page, from);
      await dragAlong(page, from, edgeward, { steps: 2, stepDelayMs: 16 });
      await dragAlong(page, edgeward, end, { steps: 10, stepDelayMs: 16 });
      await touchEnd(page, end);
      await settle(page);
      await messagesShow(page, t);
    });

    test('a vertical-first drag from the edge does nothing', async ({ page, t }) => {
      await openMessages(page, t);
      // Each step moves 15 px sideways but 40 px down: the first 10 px are clearly vertical,
      // so the gesture must be ignored even though the total sideways distance passes 35%.
      const { from, to } = edgeSwipePlan({ lang, dx: 150, y: 200, dy: 400 });
      await swipe(page, { from, to, steps: 10, stepDelayMs: 16 });
      await settle(page);
      await messagesShow(page, t);
    });

    test('Home (the root screen) does nothing', async ({ page, t }) => {
      await openHome(page, t);
      await edgeSwipe(page, { lang, dx: LONG });
      await settle(page);
      await homeShows(page, t);
    });
  });
}

// ---- flows, English only -------------------------------------------------------------------
test.describe('swipe-back flows (English)', () => {
  test.describe('signed out', () => {
    test('Login -> SignUp -> swipe -> Login', async ({ page, t }) => {
      await openSignUp(page, t);
      await edgeSwipe(page, { lang: 'en', dx: LONG });
      await expect(text(page, t('auth:login.cta'))).toBeVisible();
      await expect(text(page, t('auth:signup.headline'))).toHaveCount(0);
    });

    test('Login -> Skip -> QuizIntro -> swipe -> Login', async ({ page, t }) => {
      await page.goto('/');
      await text(page, t('auth:login.skip')).click();
      await expect(text(page, t('quiz:welcome.cta'))).toBeVisible();
      await edgeSwipe(page, { lang: 'en', dx: LONG });
      await expect(text(page, t('auth:login.cta'))).toBeVisible();
      await expect(text(page, t('quiz:welcome.cta'))).toHaveCount(0);
    });

    test('the first Quiz question ignores the swipe', async ({ page, t }) => {
      await page.goto('/');
      await text(page, t('auth:login.skip')).click();
      await text(page, t('quiz:welcome.cta')).click();
      await expect(text(page, t('quiz:name.question'))).toBeVisible();
      await edgeSwipe(page, { lang: 'en', dx: LONG });
      await settle(page);
      await expect(text(page, t('quiz:name.question'))).toBeVisible();
    });
  });

  test.describe('signed in, first-time user', () => {
    test.use({ signedIn: true });
    // Walking the whole quiz is long (real timers); same budget as quiz-onboarding.spec.js.
    test.setTimeout(180_000);

    test('Loading ignores the swipe', async ({ page, mock, t }) => {
      mock.set({ analysis: null, user: FIRST_TIME_USER });
      mock.holdAnalysis(); // keeps the Loading screen on screen
      await page.goto('/');
      await expect(text(page, t('quiz:welcome.cta'))).toBeVisible();
      await walkQuizToLoading(page, t);
      await edgeSwipe(page, { lang: 'en', dx: LONG });
      await settle(page);
      await expect(text(page, t('quiz:loading.subtitle'))).toBeVisible();
    });

    test('the first Profile after the quiz (Loading beneath) ignores the swipe', async ({ page, mock, t }) => {
      mock.set({ analysis: null, user: FIRST_TIME_USER });
      mock.holdAnalysis();
      await page.goto('/');
      await walkQuizToLoading(page, t);
      await mock.releaseAnalysis();
      await expectProfileAfterQuiz(page, t);
      await edgeSwipe(page, { lang: 'en', dx: LONG });
      await settle(page);
      await expect(text(page, t('profile:cta'))).toBeVisible();
      await expect(text(page, t('quiz:loading.subtitle'))).toHaveCount(0);
    });

    test('after onboarding reaches Home, the swipe goes back to the Notifications setup screen', async ({ page, mock, t }) => {
      mock.set({ analysis: null, user: FIRST_TIME_USER });
      mock.holdAnalysis();
      await page.goto('/');
      await walkQuizToLoading(page, t);
      await mock.releaseAnalysis();
      await expectProfileAfterQuiz(page, t);
      await finishOnboardingToHome(page, t);
      await edgeSwipe(page, { lang: 'en', dx: LONG });
      await expect(text(page, t('onboarding:notifications.title'))).toBeVisible();
    });
  });

  test.describe('signed in, side menu', () => {
    test.use({ signedIn: true });

    test('a swipe while the menu is open does not navigate back', async ({ page, t }, testInfo) => {
      await openMessages(page, t);
      await openMenu(page, t);
      await edgeSwipe(page, { lang: 'en', dx: LONG });
      await settle(page);
      // Not navigated back: Home never appears.
      await expect(page.getByText(t('home:greeting.morning'))).toHaveCount(0);
      // What the menu itself does (it is outside the swipe area, so the backdrop decides):
      // recorded as an annotation so the observed behaviour shows in the report.
      const menuStillOpen = await panelOf(page, t).isVisible();
      testInfo.annotations.push({ type: 'menu after swipe', description: menuStillOpen ? 'menu stays open' : 'menu closed' });
    });
  });
});

// ---- animated behaviour (reduced motion OFF) ----------------------------------------------
for (const lang of ['en', 'he']) {
  test.describe(`drag animation, ${lang === 'en' ? 'English' : 'Hebrew'}`, () => {
    // test.use replaces the whole contextOptions object; it only holds reducedMotion, so that is fine.
    test.use({ signedIn: true, lang, contextOptions: { reducedMotion: 'no-preference' } });

    // Guard: this block really runs with animations enabled (the override reached the page).
    test('reduced motion is off in this block', async ({ page }) => {
      await page.goto('/');
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
    });

    // +1 in English (content moves right), -1 in Hebrew (content moves left).
    const sign = lang === 'en' ? 1 : -1;

    test('mid-drag the screen carries an inline translateX with the right sign', async ({ page, t }) => {
      await openMessages(page, t);
      const { from, to } = edgeSwipePlan({ lang, dx: 100 });
      await touchStart(page, from);
      await dragAlong(page, from, to, { steps: 5, stepDelayMs: 16 }); // finger still down
      await expect.poll(async () => {
        const values = await inlineTranslates(page);
        return values.length > 0 && values.every(value => Math.sign(pxOf(value)) === sign);
      }).toBe(true);
      await touchEnd(page, to); // release (short drag: springs back)
    });

    test('a short slow drag springs back: stays on Messages, no inline translateX remains', async ({ page, t }) => {
      await openMessages(page, t);
      const { from, to } = edgeSwipePlan({ lang, dx: 60 });
      await touchStart(page, from);
      await dragAlong(page, from, to, { steps: 10, stepDelayMs: 60 }); // slow and short
      await touchEnd(page, to);
      // The release animation lasts 180 ms; polling gives it that time plus margin.
      await expect.poll(() => inlineTranslates(page), { timeout: 2000 }).toEqual([]);
      await messagesShow(page, t);
    });

    test('a quick drag that stops before release springs back (no inline translateX remains)', async ({ page, t }) => {
      await openMessages(page, t);
      const { from, to } = edgeSwipePlan({ lang, dx: 100 });
      await touchStart(page, from);
      await dragAlong(page, from, to, { steps: 2, stepDelayMs: 0 });
      await page.waitForTimeout(300); // the finger rests, so its release speed is ~0
      await touchEnd(page, to);
      await settle(page);
      await messagesShow(page, t);
      expect(await inlineTranslates(page)).toEqual([]);
    });

    test('a long drag returns to Home and no inline translateX remains', async ({ page, t }) => {
      await openMessages(page, t);
      await edgeSwipe(page, { lang, dx: LONG, steps: 10, stepDelayMs: 30 });
      await homeShows(page, t);
      await expect.poll(() => inlineTranslates(page), { timeout: 2000 }).toEqual([]);
    });
  });
}
