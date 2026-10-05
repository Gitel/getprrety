// Quiz-first landing (test-first: written BEFORE the feature exists).
//
// The entry flow being tested (plan: AI/plans/quiz-first-landing.md):
//   - A signed-out visitor boots on the LANDING, not on Login: the clinic Welcome screen when the
//     URL has a known ?ref=, otherwise QuizIntro. No authenticated API call is made.
//   - The landing (signed out) shows the Terms/Privacy consent notice, the start button and a
//     log-in control "Already have an account? Log in". It is the root screen: no Back control.
//   - Tapping the start button stamps a fresh consent that travels with the quiz answers.
//   - The log-in control opens Login. Login is a pure log-in screen: it has a Back control and
//     no "Skip for now" / "Create an account". Back and the edge swipe return to the landing.
//   - A successful log-in RESETS the stack: Home (saved analysis) or the quiz entry (none) becomes
//     the root screen, and a signed-in landing has no consent notice and no log-in control.
//   - Signed-in boot without an analysis: the same signed-in landing.
//   - Log out (side menu and Settings) lands on Login with the landing beneath it.
//   - Hebrew: Hebrew log-in text, and the RTL swipe (starting at the RIGHT edge) returns to the landing.
// The backend is the shared mock (support/mock-api.js).
import { test, expect } from './support/test.js';
import { openMenu, tapMenuItem, openSettings, backButton } from './support/nav.js';
import { walkQuizToLoading, expectProfileAfterQuiz, nameVars } from './support/quiz.js';
import { edgeSwipe, VIEWPORT_WIDTH } from './support/touch.js';

// The app's inputs have no labels, only placeholders.
const field = (page, placeholder) => page.getByPlaceholder(placeholder, { exact: true });
const text = (page, value) => page.getByText(value, { exact: true });

// Screen recognisers. QuizIntro = generic landing, Welcome = clinic (?ref=) landing.
const quizIntro = (page, t) => text(page, t('quiz:welcome.header'));
const clinicWelcome = (page, t) => text(page, t('onboarding:welcome.lu_clinic.title'));
const loginScreen = (page, t) => text(page, t('auth:login.tagline'));
const homeShows = (page, t) => expect(page.getByText(t('home:greeting.morning'))).toBeVisible();

// Start buttons.
const quizStart = (page, t) => text(page, t('quiz:welcome.cta'));
const welcomeStart = (page, t) => text(page, t('onboarding:welcome.lu_clinic.cta'));

// The consent notice is one sentence with two tappable links. Its text is
// "... <terms>LINK</terms> ... <privacy>LINK</privacy> ...", so the links are pulled out of the
// locale string and the notice counts as "visible" when both links are on screen.
const linkText = (t, tag) => t('auth:consent.agree').match(new RegExp(`<${tag}>(.*?)</${tag}>`))[1];
const consentLinks = (page, t) => [text(page, linkText(t, 'terms')), text(page, linkText(t, 'privacy'))];
async function expectConsentNotice(page, t) {
  for (const link of consentLinks(page, t)) await expect(link).toBeVisible();
}
async function expectNoConsentNotice(page, t) {
  for (const link of consentLinks(page, t)) await expect(link).toHaveCount(0);
}

// The log-in control: "Already have an account? Log in" (the accent word is a nested Text inside
// the sentence). The key does not exist yet, so t() throws until it is added: expected for now.
// Locator choice: getByText with exact:true and the WHOLE sentence. Playwright matches against an
// element's full text content (nested spans included), so the outer element that holds the
// sentence matches, while the inner "Log in" span alone does not (it is only part of the text).
// That gives exactly one match whether the control is an outlined button (QuizIntro) or a text
// link (Welcome), and it also proves both screens show the same full text. The <accent> tags of
// the locale string are removed because they are markup, not visible text.
const haveAccountText = t => t('auth:login.haveAccount').replace(/<\/?accent>/g, '');
const loginLink = (page, t) => text(page, haveAccountText(t));

// Login is a pure log-in screen: Back, form, Google section, consent notice; no Skip, no Create.
// Literal English strings are used for the REMOVED controls on purpose: their locale keys
// (auth:login.skip, auth:login.createAccount) will be deleted and t() throws on a missing key.
async function expectPureLogin(page, t) {
  await expect(loginScreen(page, t)).toBeVisible();
  await expect(backButton(page, t)).toBeVisible();
  await expect(field(page, t('auth:login.emailPlaceholder'))).toBeVisible();
  await expect(field(page, t('auth:login.passwordPlaceholder'))).toBeVisible();
  // The Google button itself renders empty in tests (the Google script is mocked as an empty
  // file), so the "or" divider that introduces the Google section is the visible proof.
  await expect(text(page, t('auth:login.or'))).toBeVisible();
  await expectConsentNotice(page, t);
  await expect(text(page, 'Skip for now')).toHaveCount(0);
  await expect(text(page, '✦ Create an account')).toHaveCount(0);
  await expect(text(page, 'Create an account')).toHaveCount(0);
}

// Types credentials and taps LOG IN (same steps as boot-auth.spec.js).
async function logIn(page, t, email = 'dana@example.com', password = 'secret-pass') {
  await field(page, t('auth:login.emailPlaceholder')).fill(email);
  await field(page, t('auth:login.passwordPlaceholder')).fill(password);
  await text(page, t('auth:login.cta')).click();
}

// A swipe past 35% of the width, as in swipe-back.spec.js.
const LONG = Math.round(VIEWPORT_WIDTH * 0.6);
// Proving "nothing happened" needs a real wait (see swipe-back.spec.js).
const settle = page => page.waitForTimeout(400);

// ---- signed-out boot ------------------------------------------------------------------------
test.describe('signed-out boot lands on the quiz, not on Login', () => {
  test('no ref: QuizIntro with consent notice, start button and log-in control, no Back, no auth calls', async ({ page, mock, t }) => {
    await page.goto('/');
    await expect(quizIntro(page, t)).toBeVisible();
    await expect(quizStart(page, t)).toBeVisible();
    await expectConsentNotice(page, t);
    await expect(loginLink(page, t)).toBeVisible();
    // The landing is the root screen: nothing beneath it, so no Back control.
    await expect(backButton(page, t)).toHaveCount(0);
    await expect(loginScreen(page, t)).toHaveCount(0);
    // No token -> the app never asks the server who the user is.
    expect(mock.callsTo('GET', '/api/auth/me')).toHaveLength(0);
    expect(mock.callsTo('GET', '/api/analysis/latest')).toHaveLength(0);
  });

  test('known ?ref=: clinic Welcome with consent notice, start button and log-in link, no Back', async ({ page, mock, t }) => {
    await page.goto('/?ref=lu_clinic');
    await expect(clinicWelcome(page, t)).toBeVisible();
    await expect(welcomeStart(page, t)).toBeVisible();
    await expectConsentNotice(page, t);
    await expect(loginLink(page, t)).toBeVisible();
    await expect(backButton(page, t)).toHaveCount(0);
    await expect(quizIntro(page, t)).toHaveCount(0);
    expect(mock.callsTo('GET', '/api/auth/me')).toHaveLength(0);
    expect(mock.callsTo('GET', '/api/analysis/latest')).toHaveLength(0);
  });

  test('unknown ?ref= is ignored: QuizIntro', async ({ page, t }) => {
    await page.goto('/?ref=not_a_clinic');
    await expect(quizIntro(page, t)).toBeVisible();
    await expect(clinicWelcome(page, t)).toHaveCount(0);
  });

  test('Welcome start button opens the quiz', async ({ page, t }) => {
    await page.goto('/?ref=lu_clinic');
    await welcomeStart(page, t).click();
    await expect(text(page, t('quiz:name.question', nameVars))).toBeVisible();
  });
});

// ---- consent stamp --------------------------------------------------------------------------
test.describe('start button stamps consent', () => {
  // The ONE test that walks the whole quiz. For an anonymous user nothing is sent until SignUp
  // (after Profile "See My Routine"); there the analysis is saved with POST /api/analysis and the
  // consent stamp rides inside body.quizAnswers (QuizScreen copies the route params into the
  // answers, sanitizeQuizAnswers keeps them). That is the cheapest request carrying the answers.
  test('a fresh v1 consent reaches the saved quiz answers', async ({ page, mock, t }) => {
    await page.goto('/');
    await expect(quizIntro(page, t)).toBeVisible();
    await walkQuizToLoading(page, t); // its first step taps the start button
    await expectProfileAfterQuiz(page, t);

    // Profile "See My Routine" -> SignUp (after-quiz variant); create the account.
    await text(page, t('profile:cta')).click();
    await field(page, t('auth:signup.emailPlaceholder')).fill('dana@example.test');
    await field(page, t('auth:signup.passwordPlaceholder')).fill('password123');
    await text(page, t('auth:signup.ctaAfterQuiz')).click();

    await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(1);
    const answers = mock.lastCall('POST', '/api/analysis').body.quizAnswers;
    expect(answers.consentVersion).toBe('v1');
    // Stamped at tap time from the test clock (fixed at 2026-09-29 09:00 UTC, then running).
    expect(answers.consentAcceptedAt).toMatch(/^2026-09-29T09:/);
  });
});

// ---- the log-in control and Login -----------------------------------------------------------
test.describe('log-in control opens Login', () => {
  test('QuizIntro: opens a pure Login; Back returns to QuizIntro', async ({ page, t }) => {
    await page.goto('/');
    await loginLink(page, t).click();
    await expectPureLogin(page, t);
    await backButton(page, t).click();
    await expect(quizIntro(page, t)).toBeVisible();
    await expect(loginScreen(page, t)).toHaveCount(0);
  });

  test('Welcome (?ref=): opens a pure Login; Back returns to Welcome', async ({ page, t }) => {
    await page.goto('/?ref=lu_clinic');
    await loginLink(page, t).click();
    await expectPureLogin(page, t);
    await backButton(page, t).click();
    await expect(clinicWelcome(page, t)).toBeVisible();
    await expect(loginScreen(page, t)).toHaveCount(0);
  });

  test('the left-edge swipe on Login returns to QuizIntro', async ({ page, t }) => {
    await page.goto('/');
    await loginLink(page, t).click();
    await expect(loginScreen(page, t)).toBeVisible();
    await edgeSwipe(page, { lang: 'en', dx: LONG });
    await expect(quizIntro(page, t)).toBeVisible();
    await expect(loginScreen(page, t)).toHaveCount(0);
  });
});

// ---- successful log-in resets the stack -----------------------------------------------------
test.describe('email log-in', () => {
  test('with a saved analysis lands on Home as the ROOT screen (swipe does nothing)', async ({ page, mock, t }) => {
    await page.goto('/');
    await loginLink(page, t).click();
    await logIn(page, t);
    await homeShows(page, t);
    expect(mock.callsTo('POST', '/api/auth/login')).toHaveLength(1);
    // The stack was reset, so the signed-out landing is not beneath Home: the swipe has no target.
    await edgeSwipe(page, { lang: 'en', dx: LONG });
    await settle(page);
    await homeShows(page, t);
    await expect(quizIntro(page, t)).toHaveCount(0);
  });

  test('without a saved analysis lands on QuizIntro as root, signed-in (no Back, no notice, no link)', async ({ page, mock, t }) => {
    mock.set({ analysis: null });
    await page.goto('/');
    await loginLink(page, t).click();
    await logIn(page, t);
    await expect(quizIntro(page, t)).toBeVisible();
    await expect(loginScreen(page, t)).toHaveCount(0);
    await expect(backButton(page, t)).toHaveCount(0);
    await expectNoConsentNotice(page, t);
    await expect(loginLink(page, t)).toHaveCount(0);
    await expect(quizStart(page, t)).toBeVisible();
  });

  test('without a saved analysis and with ?ref= lands on Welcome as root (no Back, no notice, no link)', async ({ page, mock, t }) => {
    mock.set({ analysis: null });
    await page.goto('/?ref=lu_clinic');
    await loginLink(page, t).click();
    await logIn(page, t);
    await expect(clinicWelcome(page, t)).toBeVisible();
    await expect(loginScreen(page, t)).toHaveCount(0);
    await expect(backButton(page, t)).toHaveCount(0);
    await expectNoConsentNotice(page, t);
    await expect(loginLink(page, t)).toHaveCount(0);
  });
});

// ---- signed-in boot without an analysis -----------------------------------------------------
test.describe('signed-in boot without an analysis', () => {
  test.use({ signedIn: true });

  test('QuizIntro has no consent notice and no log-in control; the start button opens the quiz', async ({ page, mock, t }) => {
    mock.set({ analysis: null });
    await page.goto('/');
    await expect(quizIntro(page, t)).toBeVisible();
    await expectNoConsentNotice(page, t);
    await expect(loginLink(page, t)).toHaveCount(0);
    await expect(backButton(page, t)).toHaveCount(0);
    await quizStart(page, t).click();
    await expect(text(page, t('quiz:name.question', nameVars))).toBeVisible();
  });
});

// ---- log out --------------------------------------------------------------------------------
test.describe('log out lands on Login with the landing beneath it', () => {
  test.use({ signedIn: true });

  // Shared checks after either log-out button: Login with Back; Back -> the signed-out landing;
  // a reload also shows the landing (the token is gone, so the app does not sign back in).
  async function expectLoggedOut(page, mock, t) {
    await expect(loginScreen(page, t)).toBeVisible();
    await expect(backButton(page, t)).toBeVisible();

    await backButton(page, t).click();
    await expect(quizIntro(page, t)).toBeVisible();
    await expectConsentNotice(page, t);
    await expect(loginLink(page, t)).toBeVisible();

    const meCallsBefore = mock.callsTo('GET', '/api/auth/me').length;
    await page.reload();
    await expect(quizIntro(page, t)).toBeVisible();
    await expect(loginLink(page, t)).toBeVisible();
    expect(mock.callsTo('GET', '/api/auth/me')).toHaveLength(meCallsBefore);
  }

  test('side menu "Log out"', async ({ page, mock, t }) => {
    await page.goto('/');
    await homeShows(page, t);
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:logout');
    await expectLoggedOut(page, mock, t);
  });

  test('Settings "Log out"', async ({ page, mock, t }) => {
    await openSettings(page, t);
    await text(page, t('settings:logout')).click();
    await expectLoggedOut(page, mock, t);
  });
});

// ---- Hebrew (RTL) ---------------------------------------------------------------------------
test.describe('Hebrew (RTL)', () => {
  test.use({ lang: 'he' });

  test('the landing shows the Hebrew log-in text; it opens Login; the RIGHT-edge swipe returns', async ({ page, t }) => {
    await page.goto('/');
    await expect(quizIntro(page, t)).toBeVisible();
    // The literal Hebrew sentence (also checked against the locale file through t()).
    expect(haveAccountText(t)).toBe('כבר יש לכם חשבון? התחברות');
    await expect(loginLink(page, t)).toBeVisible();

    await loginLink(page, t).click();
    await expect(loginScreen(page, t)).toBeVisible();
    // RTL: the back gesture starts at the right edge and drags left.
    await edgeSwipe(page, { lang: 'he', dx: LONG });
    await expect(quizIntro(page, t)).toBeVisible();
    await expect(loginScreen(page, t)).toHaveCount(0);
  });
});
