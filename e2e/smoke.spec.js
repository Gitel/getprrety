// Smoke test: the app boots to the right first screen for signed-out and signed-in users.
import { test, expect } from './support/test.js';

// Guard: playwright.config.js turns reduced motion on for every test. A wrongly named option is
// silently ignored by Playwright, so check the real browser preference here.
test('reduced motion is on by default', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
});

test.describe('signed out', () => {
  test('boots to the Login screen', async ({ page, t }) => {
    await page.goto('/');
    await expect(page.getByText(t('auth:login.tagline'))).toBeVisible();
    await expect(page.getByText(t('auth:login.cta'), { exact: true })).toBeVisible();
  });
});

test.describe('signed in', () => {
  test.use({ signedIn: true });

  test('boots to Home', async ({ page, t }) => {
    await page.goto('/');
    // 09:00 UTC (fixed clock) -> the morning greeting; the era name comes from the fixture.
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(page.getByText('Barrier Healing Era')).toBeVisible();
  });
});
