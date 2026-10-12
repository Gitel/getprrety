// Sign-in link (test-first, written 2026-10-12 BEFORE the client code exists, so it is red until
// the screens land). Contract: AI/plans/paid-booking-and-signin-link-contract.md section 7.
//
// An admin sends the customer a link  <app>/#signin=<token>. On boot, BEFORE the session loads,
// the app reads the token from the URL hash, strips it from the URL at once, and redeems it
// (POST /api/auth/link/redeem). Mock tokens (support/mock-api.js):
//   valid-signin-token -> signed in as the existing user (200)
//   invite-token       -> first needs consent (400 consent_required), then creates the account (201)
//   anything else      -> 400 link_invalid
// After a successful link the app lands on the skin-analysis start (QuizIntro), signed in.
import { test, expect } from './support/test.js';
import { makeT } from './support/i18n.js';

const tHe = makeT('he');

// QuizIntro = the skin-analysis start screen (same locator as boot-auth.spec.js).
const quizIntro = (page, t) => page.getByText(t('quiz:welcome.header'), { exact: true });
// The stored token (Capacitor Preferences on the web: key "CapacitorStorage.gp_token").
const storedToken = page => page.evaluate(() => localStorage.getItem('CapacitorStorage.gp_token'));

test.describe('signed out', () => {
  test('a valid link signs in, strips the hash, stores the token and opens the skin-analysis start', async ({ page, mock, t }) => {
    await page.goto('/#signin=valid-signin-token');
    await expect(quizIntro(page, t)).toBeVisible();

    // The redeem call carried the token from the hash (no consent for an existing account).
    const calls = mock.callsTo('POST', '/api/auth/link/redeem');
    expect(calls).toHaveLength(1);
    expect(calls[0].body.token).toBe('valid-signin-token');
    // The secret is gone from the address bar (it must not stay in history or be shared).
    expect(page.url()).not.toContain('signin=');
    // Signed in: the token is stored and the session was loaded with it.
    expect(await storedToken(page)).toBe('e2e-token');
    await expect.poll(() => mock.lastCall('GET', '/api/auth/me')?.authed).toBe(true);
    // Not Home, even though the user has a saved analysis.
    await expect(page.getByText(t('home:greeting.morning'))).toHaveCount(0);
  });

  test('an invalid link shows the invalid-link text; Continue goes to the normal landing', async ({ page, mock, t }) => {
    await page.goto('/#signin=bad');
    await expect(page.getByTestId('link-invalid')).toBeVisible();
    await expect(page.getByTestId('link-invalid')).toContainText(t('auth:linkInvalid'));
    expect(page.url()).not.toContain('signin=');
    expect(mock.callsTo('POST', '/api/auth/link/redeem')[0].body.token).toBe('bad');
    expect(await storedToken(page)).toBeNull();

    await page.getByTestId('link-welcome-continue').click();
    await expect(quizIntro(page, t)).toBeVisible();
    // The signed-out landing: still not signed in.
    expect(await storedToken(page)).toBeNull();
  });

  test('a first-time invite shows the welcome screen; Continue sends the consent and signs in', async ({ page, mock, t }) => {
    await page.goto('/#signin=invite-token');
    const welcome = page.getByTestId('link-welcome-screen');
    await expect(welcome).toBeVisible();
    await expect(welcome).toContainText(t('auth:linkInviteTitle'));
    // The consent notice (Terms + Privacy links) is part of the screen.
    const link = tag => t('auth:consent.agree').match(new RegExp(`<${tag}>(.*?)</${tag}>`))[1];
    await expect(welcome).toContainText(link('terms'));
    await expect(welcome).toContainText(link('privacy'));
    expect(page.url()).not.toContain('signin=');

    // The first call (without consent) was refused with consent_required and did not sign in.
    const first = mock.callsTo('POST', '/api/auth/link/redeem');
    expect(first).toHaveLength(1);
    expect(first[0].body.consentAcceptedAt).toBeUndefined();
    expect(await storedToken(page)).toBeNull();

    await page.getByTestId('link-welcome-continue').click();
    await expect(quizIntro(page, t)).toBeVisible();

    // The second call carries the consent stamp (test clock, like sign up) and the version.
    const calls = mock.callsTo('POST', '/api/auth/link/redeem');
    expect(calls).toHaveLength(2);
    expect(calls[1].body.token).toBe('invite-token');
    expect(calls[1].body.consentAcceptedAt).toMatch(/^2026-09-29T09:/);
    expect(calls[1].body.consentVersion).toBe('v1');
    expect(await storedToken(page)).toBe('e2e-token');
  });
});

test.describe('already signed in', () => {
  test.use({ signedIn: true });

  test('a valid link ends on the skin-analysis start, not Home', async ({ page, mock, t }) => {
    await page.goto('/#signin=valid-signin-token');
    await expect(quizIntro(page, t)).toBeVisible();
    expect(mock.callsTo('POST', '/api/auth/link/redeem')).toHaveLength(1);
    expect(page.url()).not.toContain('signin=');
    await expect(page.getByText(t('home:greeting.morning'))).toHaveCount(0);
  });
});

test.describe('Hebrew', () => {
  test.use({ lang: 'he' });

  test('an invalid link shows the Hebrew invalid-link text (RTL)', async ({ page }) => {
    await page.goto('/#signin=bad');
    await expect(page.getByTestId('link-invalid')).toContainText(tHe('auth:linkInvalid'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
