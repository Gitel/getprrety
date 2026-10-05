// T-B1: boot routing + authentication, locked in as the app behaves TODAY.
// Covers: Splash routing when signed in (and the invalid-token case), Login (reached from the
// landing's "Already have an account? Log in" control) and the after-quiz Sign up.
// The signed-out landing, "no Skip / no Create an account on Login" and Log out live in
// landing.spec.js. The backend is the shared mock (support/mock-api.js); error responses use
// mock.override.
import { test, expect } from './support/test.js';
import { openLogin } from './support/nav.js';
import { walkQuizToLoading, expectProfileAfterQuiz } from './support/quiz.js';

// The app's inputs have no labels, only placeholders.
const field = (page, placeholder) => page.getByPlaceholder(placeholder, { exact: true });

// Locators that identify each screen. QuizIntro = generic quiz entry, Welcome = clinic (?ref=) entry.
const quizIntro = (page, t) => page.getByText(t('quiz:welcome.header'), { exact: true });
const clinicWelcome = (page, t) => page.getByText(t('onboarding:welcome.lu_clinic.title'), { exact: true });
const loginScreen = (page, t) => page.getByText(t('auth:login.tagline'), { exact: true });

// The landing's log-in control text: the locale string minus its <accent> markup.
const haveAccountText = t => t('auth:login.haveAccount').replace(/<\/?accent>/g, '');

// Pulls a link text out of the locale string "... <terms>LINK</terms> ... <privacy>LINK</privacy> ...".
const linkText = (t, tag) => t('auth:consent.agree').match(new RegExp(`<${tag}>(.*?)</${tag}>`))[1];

test.describe('Splash routing, signed in', () => {
  test.use({ signedIn: true });

  test('with a saved analysis goes to Home and restores the session', async ({ page, mock, t }) => {
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    // Both requests of loadSession carry the token.
    expect(mock.lastCall('GET', '/api/auth/me').authed).toBe(true);
    expect(mock.lastCall('GET', '/api/analysis/latest').authed).toBe(true);
  });

  test('with no saved analysis goes to the generic quiz intro', async ({ page, mock, t }) => {
    mock.set({ analysis: null });
    await page.goto('/');
    await expect(quizIntro(page, t)).toBeVisible();
  });

  test('no analysis + known ?ref= goes to the clinic Welcome screen', async ({ page, mock, t }) => {
    mock.set({ analysis: null });
    await page.goto('/?ref=lu_clinic');
    await expect(clinicWelcome(page, t)).toBeVisible();
    await expect(page.getByText(t('onboarding:welcome.lu_clinic.cta'), { exact: true })).toBeVisible();
  });

  test('no analysis + unknown ?ref= is ignored: generic quiz intro', async ({ page, mock, t }) => {
    mock.set({ analysis: null });
    await page.goto('/?ref=not_a_clinic');
    await expect(quizIntro(page, t)).toBeVisible();
  });

  test('with a saved analysis + ?ref= still goes straight to Home', async ({ page, t }) => {
    await page.goto('/?ref=lu_clinic');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(clinicWelcome(page, t)).toHaveCount(0);
  });

  test('an invalid stored token (401) is dropped and the user lands on the landing (QuizIntro)', async ({ page, mock, t }) => {
    // /me answers 401 -> loadSession removes the token -> Splash sees no user -> the signed-out
    // landing (QuizIntro, not Login).
    mock.override('GET', '/api/auth/me', 401, { error: 'Invalid or expired token', code: 'auth_invalid' });
    await page.goto('/');
    await expect(quizIntro(page, t)).toBeVisible();
    await expect(loginScreen(page, t)).toHaveCount(0);
    // It is the SIGNED-OUT variant: the consent notice links and the log-in sentence are shown.
    await expect(page.getByText(linkText(t, 'terms'), { exact: true })).toBeVisible();
    await expect(page.getByText(linkText(t, 'privacy'), { exact: true })).toBeVisible();
    await expect(page.getByText(haveAccountText(t), { exact: true })).toBeVisible();
    // The token was removed, so a reload also stays on the landing.
    await page.reload();
    await expect(quizIntro(page, t)).toBeVisible();
  });
});

test.describe('Login (opened from the landing log-in control)', () => {
  // Types credentials and taps LOG IN.
  async function logIn(page, t, email, password) {
    await field(page, t('auth:login.emailPlaceholder')).fill(email);
    await field(page, t('auth:login.passwordPlaceholder')).fill(password);
    await page.getByText(t('auth:login.cta'), { exact: true }).click();
  }

  test('email login sends trimmed lower-case email + password and lands on Home', async ({ page, mock, t }) => {
    await openLogin(page, t);
    await logIn(page, t, '  Dana@Example.COM ', 'secret-pass');

    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    // Email is trimmed and lower-cased; the password is sent as typed.
    expect(mock.lastCall('POST', '/api/auth/login').body).toEqual({ email: 'dana@example.com', password: 'secret-pass' });
    // After login the app fetches the saved analysis with the new token.
    expect(mock.lastCall('GET', '/api/analysis/latest').authed).toBe(true);
  });

  test('email login without a saved analysis lands on the quiz intro', async ({ page, mock, t }) => {
    mock.set({ analysis: null });
    await openLogin(page, t);
    await logIn(page, t, 'dana@example.com', 'secret-pass');
    await expect(quizIntro(page, t)).toBeVisible();
  });

  test('email login without analysis and with ?ref= lands on the clinic Welcome', async ({ page, mock, t }) => {
    mock.set({ analysis: null });
    await page.goto('/?ref=lu_clinic');
    // On the clinic Welcome landing the log-in control is the same sentence as on QuizIntro.
    await page.getByText(haveAccountText(t), { exact: true }).click();
    await logIn(page, t, 'dana@example.com', 'secret-pass');
    await expect(clinicWelcome(page, t)).toBeVisible();
  });

  test('empty form shows the missing-fields message and calls no API', async ({ page, mock, t }) => {
    await openLogin(page, t);
    await page.getByText(t('auth:login.cta'), { exact: true }).click();
    await expect(page.getByText(t('auth:login.missingFields'), { exact: true })).toBeVisible();
    expect(mock.callsTo('POST', '/api/auth/login')).toHaveLength(0);
  });

  test('typing clears the error message', async ({ page, t }) => {
    await openLogin(page, t);
    await page.getByText(t('auth:login.cta'), { exact: true }).click();
    const error = page.getByText(t('auth:login.missingFields'), { exact: true });
    await expect(error).toBeVisible();
    await field(page, t('auth:login.emailPlaceholder')).fill('d');
    await expect(error).toHaveCount(0);
  });

  test('wrong credentials show the translated error for the server code', async ({ page, mock, t }) => {
    // Same shape as server/routes/auth.js: 401 + { error, code }.
    mock.override('POST', '/api/auth/login', 401, { error: 'Invalid email or password', code: 'invalid_credentials' });
    await openLogin(page, t);
    await logIn(page, t, 'dana@example.com', 'wrong-pass');
    await expect(page.getByText(t('errors:invalid_credentials'), { exact: true })).toBeVisible();
    // Still on Login.
    await expect(loginScreen(page, t)).toBeVisible();
  });

  test('a server error without a known code shows the generic "our side" message', async ({ page, mock, t }) => {
    mock.override('POST', '/api/auth/login', 500, {});
    await openLogin(page, t);
    await logIn(page, t, 'dana@example.com', 'secret-pass');
    await expect(page.getByText(t('errors:server_error'), { exact: true })).toBeVisible();
  });

  test('a 4xx with an unknown code shows the screen fallback text', async ({ page, mock, t }) => {
    mock.override('POST', '/api/auth/login', 400, { error: 'whatever', code: 'not_a_real_code' });
    await openLogin(page, t);
    await logIn(page, t, 'dana@example.com', 'secret-pass');
    await expect(page.getByText(t('auth:login.failed'), { exact: true })).toBeVisible();
  });

  test('shows the consent notice; Terms and Privacy links open the configured URLs', async ({ page, t }) => {
    // Record window.open calls instead of opening real tabs (Linking.openURL uses window.open on web).
    await page.addInitScript(() => {
      window.__opened = [];
      window.open = url => { window.__opened.push(String(url)); return null; };
    });
    await openLogin(page, t);
    const terms = linkText(t, 'terms');
    const privacy = linkText(t, 'privacy');
    await expect(page.getByText(terms, { exact: true })).toBeVisible();
    await page.getByText(terms, { exact: true }).click();
    await page.getByText(privacy, { exact: true }).click();
    // URLs come from the VITE_TERMS_URL / VITE_PRIVACY_URL values set in playwright.config.js.
    await expect.poll(() => page.evaluate(() => window.__opened)).toEqual([
      'https://example.test/terms',
      'https://example.test/privacy',
    ]);
  });
});

test.describe('Sign up (only after the quiz)', () => {
  // The quiz walk takes ~35 s (real timers), so it is walked ONCE and every sign-up check runs
  // in order on the same screen. (The full anonymous flow, incl. Back and the saved analysis,
  // is in quiz-onboarding.spec.js.)
  test.setTimeout(180_000);

  test('quiz -> Profile -> SignUp: validation, consent notice, taken email, then a valid sign up', async ({ page, mock, t }) => {
    await page.goto('/');
    await walkQuizToLoading(page, t);
    await expectProfileAfterQuiz(page, t);
    await page.getByText(t('profile:cta'), { exact: true }).click();

    const submit = page.getByText(t('auth:signup.ctaAfterQuiz'), { exact: true });
    const emailBox = field(page, t('auth:signup.emailPlaceholder'));
    const passwordBox = field(page, t('auth:signup.passwordPlaceholder'));
    const message = key => page.getByText(t(key), { exact: true });

    // The after-quiz copy is showing (its headline needs the era name and is split over nested
    // text, so the plain sub-line proves it), and the first name was pre-filled from the quiz answers.
    await expect(message('auth:signup.subAfterQuiz')).toBeVisible();
    await expect(field(page, t('auth:signup.firstNamePlaceholder'))).toHaveValue('Dana');

    // 1. Empty submit: email and password are required, no API call.
    await submit.click();
    await expect(message('auth:signup.emailRequired')).toBeVisible();
    await expect(message('auth:signup.passwordRequired')).toBeVisible();
    expect(mock.callsTo('POST', '/api/auth/signup')).toHaveLength(0);

    // 2. Typing in a field clears only that field's message.
    await emailBox.fill('a');
    await expect(message('auth:signup.emailRequired')).toHaveCount(0);
    await expect(message('auth:signup.passwordRequired')).toBeVisible();

    // 3. Invalid email + short password show their messages, still no API call.
    await emailBox.fill('not-an-email');
    await passwordBox.fill('short');
    await submit.click();
    await expect(message('auth:signup.emailInvalid')).toBeVisible();
    await expect(message('auth:signup.passwordTooShort')).toBeVisible();
    expect(mock.callsTo('POST', '/api/auth/signup')).toHaveLength(0);

    // 4. The consent notice (Terms + Privacy links) is shown above the button.
    await expect(page.getByText(linkText(t, 'terms'), { exact: true })).toBeVisible();
    await expect(page.getByText(linkText(t, 'privacy'), { exact: true })).toBeVisible();

    // 5. A taken email shows the translated server error (the form stays on screen).
    mock.override('POST', '/api/auth/signup', 409, { error: 'Email already registered', code: 'email_taken' });
    await emailBox.fill('Dana@Example.com');
    await passwordBox.fill('longenough1');
    await submit.click();
    await expect(message('errors:email_taken')).toBeVisible();
    expect(mock.callsTo('POST', '/api/auth/signup')).toHaveLength(1);
    // The pre-filled first name is sent; the final submit later checks an emptied one is left out.
    expect(mock.lastCall('POST', '/api/auth/signup').body).toMatchObject({ firstName: 'Dana' });

    // 6. Back to the normal mock answer, submit again: the account is created, SkinTiming opens.
    mock.clearOverride('POST', '/api/auth/signup');
    // Clear the pre-filled first name: an empty one must be left out of the body (firstName.trim() || undefined).
    await field(page, t('auth:signup.firstNamePlaceholder')).fill('');
    await submit.click();
    await expect(page.getByText(t('onboarding:timing.headline'), { exact: true })).toBeVisible();
    const body = mock.lastCall('POST', '/api/auth/signup').body;
    // The first name was cleared, so it is not sent; the password is sent as typed.
    expect(body).not.toHaveProperty('firstName');
    expect(body).toMatchObject({ password: 'longenough1', consentVersion: 'v1' });
    // CURRENT BEHAVIOUR: unlike Login, the client sends the email exactly as typed. This is not a
    // bug: the server normalises it (server/routes/auth.js trims + lower-cases, and the User
    // model's email field is lowercase + trim).
    expect(body.email).toBe('Dana@Example.com');
    // Consent is stamped at tap time from the test clock (fixed at 2026-09-29 09:00 UTC, then running).
    expect(body.consentAcceptedAt).toMatch(/^2026-09-29T09:/);
  });
});
