// T-B1: boot routing + authentication, locked in as the app behaves TODAY.
// Covers: Splash routing (with and without ?ref=), Login, Sign up, "Skip for now", Log out.
// The backend is the shared mock (support/mock-api.js); error responses use mock.override.
import { test, expect } from './support/test.js';
import { openSignUp, openMenu, tapMenuItem, backButton } from './support/nav.js';

// The app's inputs have no labels, only placeholders.
const field = (page, placeholder) => page.getByPlaceholder(placeholder, { exact: true });

// Locators that identify each screen. QuizIntro = generic quiz entry, Welcome = clinic (?ref=) entry.
const quizIntro = (page, t) => page.getByText(t('quiz:welcome.header'), { exact: true });
const clinicWelcome = (page, t) => page.getByText(t('onboarding:welcome.lu_clinic.title'), { exact: true });
const loginScreen = (page, t) => page.getByText(t('auth:login.tagline'), { exact: true });

// Pulls a link text out of the locale string "... <terms>LINK</terms> ... <privacy>LINK</privacy> ...".
const linkText = (t, tag) => t('auth:consent.agree').match(new RegExp(`<${tag}>(.*?)</${tag}>`))[1];

test.describe('Splash routing, signed out', () => {
  test('goes to Login and makes no authenticated calls', async ({ page, mock, t }) => {
    await page.goto('/');
    await expect(loginScreen(page, t)).toBeVisible();
    // No token -> loadSession returns early: the app never asks the server who the user is.
    expect(mock.callsTo('GET', '/api/auth/me')).toHaveLength(0);
    expect(mock.callsTo('GET', '/api/analysis/latest')).toHaveLength(0);
  });

  test('with a known ?ref= still goes to Login (not Welcome)', async ({ page, t }) => {
    await page.goto('/?ref=lu_clinic');
    await expect(loginScreen(page, t)).toBeVisible();
    await expect(clinicWelcome(page, t)).toHaveCount(0);
  });
});

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

  test('an invalid stored token (401) is dropped and the user lands on Login', async ({ page, mock, t }) => {
    // /me answers 401 -> loadSession removes the token -> Splash sees no user -> Login.
    mock.override('GET', '/api/auth/me', 401, { error: 'Invalid or expired token', code: 'auth_invalid' });
    await page.goto('/');
    await expect(loginScreen(page, t)).toBeVisible();
    // The token was removed, so a reload also stays on Login.
    await page.reload();
    await expect(loginScreen(page, t)).toBeVisible();
  });
});

test.describe('Login', () => {
  // Types credentials and taps LOG IN.
  async function logIn(page, t, email, password) {
    await field(page, t('auth:login.emailPlaceholder')).fill(email);
    await field(page, t('auth:login.passwordPlaceholder')).fill(password);
    await page.getByText(t('auth:login.cta'), { exact: true }).click();
  }

  test('email login sends trimmed lower-case email + password and lands on Home', async ({ page, mock, t }) => {
    await page.goto('/');
    await logIn(page, t, '  Dana@Example.COM ', 'secret-pass');

    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    // Email is trimmed and lower-cased; the password is sent as typed.
    expect(mock.lastCall('POST', '/api/auth/login').body).toEqual({ email: 'dana@example.com', password: 'secret-pass' });
    // After login the app fetches the saved analysis with the new token.
    expect(mock.lastCall('GET', '/api/analysis/latest').authed).toBe(true);
  });

  test('email login without a saved analysis lands on the quiz intro', async ({ page, mock, t }) => {
    mock.set({ analysis: null });
    await page.goto('/');
    await logIn(page, t, 'dana@example.com', 'secret-pass');
    await expect(quizIntro(page, t)).toBeVisible();
  });

  test('email login without analysis and with ?ref= lands on the clinic Welcome', async ({ page, mock, t }) => {
    mock.set({ analysis: null });
    await page.goto('/?ref=lu_clinic');
    await logIn(page, t, 'dana@example.com', 'secret-pass');
    await expect(clinicWelcome(page, t)).toBeVisible();
  });

  test('empty form shows the missing-fields message and calls no API', async ({ page, mock, t }) => {
    await page.goto('/');
    await page.getByText(t('auth:login.cta'), { exact: true }).click();
    await expect(page.getByText(t('auth:login.missingFields'), { exact: true })).toBeVisible();
    expect(mock.callsTo('POST', '/api/auth/login')).toHaveLength(0);
  });

  test('typing clears the error message', async ({ page, t }) => {
    await page.goto('/');
    await page.getByText(t('auth:login.cta'), { exact: true }).click();
    const error = page.getByText(t('auth:login.missingFields'), { exact: true });
    await expect(error).toBeVisible();
    await field(page, t('auth:login.emailPlaceholder')).fill('d');
    await expect(error).toHaveCount(0);
  });

  test('wrong credentials show the translated error for the server code', async ({ page, mock, t }) => {
    // Same shape as server/routes/auth.js: 401 + { error, code }.
    mock.override('POST', '/api/auth/login', 401, { error: 'Invalid email or password', code: 'invalid_credentials' });
    await page.goto('/');
    await logIn(page, t, 'dana@example.com', 'wrong-pass');
    await expect(page.getByText(t('errors:invalid_credentials'), { exact: true })).toBeVisible();
    // Still on Login.
    await expect(loginScreen(page, t)).toBeVisible();
  });

  test('a server error without a known code shows the generic "our side" message', async ({ page, mock, t }) => {
    mock.override('POST', '/api/auth/login', 500, {});
    await page.goto('/');
    await logIn(page, t, 'dana@example.com', 'secret-pass');
    await expect(page.getByText(t('errors:server_error'), { exact: true })).toBeVisible();
  });

  test('a 4xx with an unknown code shows the screen fallback text', async ({ page, mock, t }) => {
    mock.override('POST', '/api/auth/login', 400, { error: 'whatever', code: 'not_a_real_code' });
    await page.goto('/');
    await logIn(page, t, 'dana@example.com', 'secret-pass');
    await expect(page.getByText(t('auth:login.failed'), { exact: true })).toBeVisible();
  });

  test('shows the consent notice; Terms and Privacy links open the configured URLs', async ({ page, t }) => {
    // Record window.open calls instead of opening real tabs (Linking.openURL uses window.open on web).
    await page.addInitScript(() => {
      window.__opened = [];
      window.open = url => { window.__opened.push(String(url)); return null; };
    });
    await page.goto('/');
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

test.describe('Create an account / Sign up', () => {
  test('"Create an account" opens the pre-quiz Sign up page', async ({ page, t }) => {
    await openSignUp(page, t);
    await expect(page.getByText(t('auth:signup.sub'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('auth:signup.cta'), { exact: true })).toBeVisible();
  });

  test('empty submit shows email and password required, no API call', async ({ page, mock, t }) => {
    await openSignUp(page, t);
    await page.getByText(t('auth:signup.cta'), { exact: true }).click();
    await expect(page.getByText(t('auth:signup.emailRequired'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('auth:signup.passwordRequired'), { exact: true })).toBeVisible();
    expect(mock.callsTo('POST', '/api/auth/signup')).toHaveLength(0);
  });

  test('invalid email and short password show their messages', async ({ page, mock, t }) => {
    await openSignUp(page, t);
    await field(page, t('auth:signup.emailPlaceholder')).fill('not-an-email');
    await field(page, t('auth:signup.passwordPlaceholder')).fill('short');
    await page.getByText(t('auth:signup.cta'), { exact: true }).click();
    await expect(page.getByText(t('auth:signup.emailInvalid'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('auth:signup.passwordTooShort'), { exact: true })).toBeVisible();
    expect(mock.callsTo('POST', '/api/auth/signup')).toHaveLength(0);
  });

  test('typing in a field clears only that field message', async ({ page, t }) => {
    await openSignUp(page, t);
    await page.getByText(t('auth:signup.cta'), { exact: true }).click();
    await expect(page.getByText(t('auth:signup.emailRequired'), { exact: true })).toBeVisible();
    await field(page, t('auth:signup.emailPlaceholder')).fill('a');
    await expect(page.getByText(t('auth:signup.emailRequired'), { exact: true })).toHaveCount(0);
    await expect(page.getByText(t('auth:signup.passwordRequired'), { exact: true })).toBeVisible();
  });

  test('valid sign up sends the body with a consent stamp and starts the quiz', async ({ page, mock, t }) => {
    await openSignUp(page, t);
    await field(page, t('auth:signup.firstNamePlaceholder')).fill('Dana');
    await field(page, t('auth:signup.emailPlaceholder')).fill('dana@example.com');
    await field(page, t('auth:signup.passwordPlaceholder')).fill('longenough1');
    await page.getByText(t('auth:signup.cta'), { exact: true }).click();

    // Before the quiz nothing is saved yet: the new account starts at the quiz intro.
    await expect(quizIntro(page, t)).toBeVisible();
    const body = mock.lastCall('POST', '/api/auth/signup').body;
    expect(body).toMatchObject({ firstName: 'Dana', email: 'dana@example.com', password: 'longenough1', consentVersion: 'v1' });
    // Consent is stamped at tap time from the test clock (fixed at 2026-09-29 09:00 UTC, then running).
    expect(body.consentAcceptedAt).toMatch(/^2026-09-29T09:/);
    // The quiz intro was opened with navigation.reset(): no Back button to the auth screens.
    await expect(backButton(page, t)).toHaveCount(0);
  });

  test('sign up leaves out an empty first name and keeps the email as typed', async ({ page, mock, t }) => {
    await openSignUp(page, t);
    await field(page, t('auth:signup.emailPlaceholder')).fill('Dana@Example.com');
    await field(page, t('auth:signup.passwordPlaceholder')).fill('longenough1');
    await page.getByText(t('auth:signup.cta'), { exact: true }).click();
    await expect(quizIntro(page, t)).toBeVisible();
    const body = mock.lastCall('POST', '/api/auth/signup').body;
    expect(body).not.toHaveProperty('firstName');
    // CURRENT BEHAVIOUR: unlike Login, the client sends the email exactly as typed. This is not a
    // bug: the server normalises it (server/routes/auth.js trims + lower-cases, and the User
    // model's email field is lowercase + trim).
    expect(body.email).toBe('Dana@Example.com');
  });

  test('a taken email shows the translated server error', async ({ page, mock, t }) => {
    mock.override('POST', '/api/auth/signup', 409, { error: 'Email already registered', code: 'email_taken' });
    await openSignUp(page, t);
    await field(page, t('auth:signup.emailPlaceholder')).fill('dana@example.com');
    await field(page, t('auth:signup.passwordPlaceholder')).fill('longenough1');
    await page.getByText(t('auth:signup.cta'), { exact: true }).click();
    await expect(page.getByText(t('errors:email_taken'), { exact: true })).toBeVisible();
  });

  test('shows the consent notice above the button', async ({ page, t }) => {
    await openSignUp(page, t);
    await expect(page.getByText(linkText(t, 'terms'), { exact: true })).toBeVisible();
    await expect(page.getByText(linkText(t, 'privacy'), { exact: true })).toBeVisible();
  });
});

test.describe('Skip for now', () => {
  test('opens the generic quiz intro', async ({ page, t }) => {
    await page.goto('/');
    await page.getByText(t('auth:login.skip'), { exact: true }).click();
    await expect(quizIntro(page, t)).toBeVisible();
    // (Its Back-to-Login behaviour is covered in quiz-onboarding.spec.js.)
  });

  test('opens the clinic Welcome screen when the URL has a known ?ref=', async ({ page, t }) => {
    await page.goto('/?ref=lu_clinic');
    await page.getByText(t('auth:login.skip'), { exact: true }).click();
    await expect(clinicWelcome(page, t)).toBeVisible();
    // Welcome has no Back control, even though it sits on top of Login.
    await expect(backButton(page, t)).toHaveCount(0);
  });

  test('makes no API calls (anonymous flow)', async ({ page, mock, t }) => {
    await page.goto('/');
    await page.getByText(t('auth:login.skip'), { exact: true }).click();
    await expect(quizIntro(page, t)).toBeVisible();
    expect(mock.calls).toHaveLength(0);
  });
});

test.describe('Log out', () => {
  test.use({ signedIn: true });

  test('side menu "Log out" returns to Login and a reload stays signed out', async ({ page, mock, t }) => {
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:logout');

    await expect(loginScreen(page, t)).toBeVisible();

    // The token is gone: after a reload the app does not sign back in (no new /me call).
    const meCallsBefore = mock.callsTo('GET', '/api/auth/me').length;
    await page.reload();
    await expect(loginScreen(page, t)).toBeVisible();
    expect(mock.callsTo('GET', '/api/auth/me')).toHaveLength(meCallsBefore);
  });
});
