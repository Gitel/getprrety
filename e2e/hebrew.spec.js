// Baseline: the app booted in Hebrew (stored device language = 'he').
// These tests describe what the app does TODAY. The language switch itself is covered elsewhere.
//
// Facts used here (see src/lib/languageSync.js):
//   UI language = pending ?? account (user.language) ?? device ?? 'en'.
// The default fixture user has NO `language`, so the device language ('he') wins.
import { test, expect } from './support/test.js';

test.use({ lang: 'he' });

// Same CORS headers as e2e/support/mock-api.js (needed because the API is on another origin).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

// Local override of GET /api/auth/me so the account carries its own language.
// (The shared mock's user has no `language`.) Page routes win over the context router.
async function accountSaysLanguage(page, language) {
  await page.route('http://api.e2e.test/api/auth/me', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (request.method() !== 'GET') return route.fallback();
    // Same user as the shared fixture, plus the account language.
    return route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          _id: 'user-1',
          id: 'user-1',
          firstName: 'Dana',
          email: 'dana@example.test',
          termsAcceptedAt: '2026-09-15T08:00:00.000Z',
          consentVersion: 'v1',
          skincareTiming: 'morning',
          language,
        },
      }),
    });
  });
}

test.describe('signed out, Hebrew', () => {
  test('html is rtl/he and the Login screen is in Hebrew', async ({ page, t }) => {
    await page.goto('/');
    await expect(page.getByText(t('auth:login.tagline'))).toBeVisible();
    await expect(page.getByText(t('auth:login.cta'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('auth:login.createAccount'))).toBeVisible();
    await expect(page.getByText(t('auth:login.skip'))).toBeVisible();
    await expect(page.getByPlaceholder(t('auth:login.emailPlaceholder'))).toBeVisible();
    await expect(page.getByPlaceholder(t('auth:login.passwordPlaceholder'))).toBeVisible();
    // <html> follows the language (set by src/lib/i18n.js on languageChanged).
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  });

  test('the Sign up screen shows the Hebrew Back label', async ({ page, t }) => {
    await page.goto('/');
    await page.getByText(t('auth:login.createAccount')).click();
    await expect(page.getByText(t('common:back'))).toBeVisible();
  });
});

test.describe('signed in, Hebrew', () => {
  test.use({ signedIn: true });

  test('Home greets in Hebrew and html is rtl/he', async ({ page, t }) => {
    await page.goto('/');
    // Fixed clock is 09:00 UTC -> the morning greeting.
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  });

  test('the menu opens from the RIGHT edge with Hebrew labels', async ({ page, t, mock }) => {
    mock.set({ unread: 0 }); // no unread badge, so the item label is the plain one
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await page.getByRole('button', { name: t('menu:open') }).click();

    const panel = page.getByLabel(t('menu:panel'), { exact: true });
    await expect(panel).toBeVisible();
    // Hebrew item labels.
    await expect(page.getByText(t('menu:myRoutine'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('menu:settings'), { exact: true })).toBeVisible();

    // Mirroring proof: the panel slides in from the right, so once the 200 ms slide has
    // finished its right edge touches the viewport's right edge (and it is not at the left).
    const viewportWidth = page.viewportSize().width;
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return Math.round(box.x + box.width);
      })
      .toBe(viewportWidth);
    expect((await panel.boundingBox()).x).toBeGreaterThan(0);
  });

  test('Messages: Hebrew title/subtitle and an RTL-marked sender line', async ({ page, t, mock }) => {
    mock.set({ unread: 0 });
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await page.getByRole('button', { name: t('menu:open') }).click();
    await page.getByRole('button', { name: t('menu:messages'), exact: true }).click();

    await expect(page.getByText(t('messages:title'), { exact: true }).first()).toBeVisible();
    await expect(page.getByText(t('messages:subtitle'))).toBeVisible();
    await expect(page.getByText(t('common:back'))).toBeVisible();

    // Sender lines look like: RLM + who + " middle-dot " + FSI + time + PDI (see senderLine()).
    // Find them by their isolate marks; the RLM must be the very first character.
    const senderLines = page.getByText(/⁨.*⁩/);
    await expect(senderLines.first()).toBeVisible();
    const all = await senderLines.allTextContents();
    expect(all.length).toBeGreaterThan(0);
    for (const line of all) {
      expect(line.startsWith('‏')).toBe(true);
      expect(line).toContain(' · ');
      expect(line).toMatch(/⁨[^⁩]+⁩$/); // a non-empty, isolated time at the end
    }
    // Both speakers use the Hebrew words for "you" / "the clinic".
    expect(all.some(x => x.includes(t('messages:you')))).toBe(true);
    expect(all.some(x => x.includes(t('messages:clinic')))).toBe(true);
  });

  test('Settings is in Hebrew including the Back label', async ({ page, t, mock }) => {
    mock.set({ unread: 0 });
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await page.getByRole('button', { name: t('menu:open') }).click();
    await page.getByRole('button', { name: t('menu:settings'), exact: true }).click();

    await expect(page.getByText(t('settings:title'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('settings:remindersTitle'))).toBeVisible();
    await expect(page.getByText(t('common:back'))).toBeVisible();
  });
});

// The language rule with a device language of 'he' and an account that says otherwise.
test.describe('device language he vs account language', () => {
  test.use({ signedIn: true });

  test('account language en wins over the device he (UI turns English, device key is kept)', async ({ page, t }) => {
    await accountSaysLanguage(page, 'en');
    await page.goto('/');
    // The `t` fixture reads Hebrew here, so we prove "English" by html attributes and by the
    // Hebrew greeting being absent.
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText(t('home:greeting.morning'))).toHaveCount(0);
    // Booting never overwrites the stored device choice (languageSync: "writes nothing").
    const stored = await page.evaluate(() => localStorage.getItem('CapacitorStorage.app.language'));
    expect(stored).toBe('he');
  });

  test('account language he agrees with the device: Hebrew', async ({ page, t }) => {
    await accountSaysLanguage(page, 'he');
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('an account with no language falls back to the device language: Hebrew', async ({ page, t }) => {
    await accountSaysLanguage(page, null);
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
