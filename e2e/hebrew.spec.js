// Baseline: the app booted in Hebrew (stored device language = 'he').
// These tests describe what the app does TODAY. The language switch itself is covered elsewhere.
//
// Facts used here (see src/lib/languageSync.js):
//   UI language = pending ?? account (user.language) ?? device ?? 'en'.
// The default fixture user has NO `language`, so the device language ('he') wins.
import { test, expect } from './support/test.js';
import { USER } from './support/fixtures-data.js';
import { makeT } from './support/i18n.js';
import { openMenu, panelOf, backButton, openMessages, openSettings, openSignUp } from './support/nav.js';

test.use({ lang: 'he' });

// Feeds the shared mock a user whose account carries its own language (GET /api/auth/me).
// Call it BEFORE page.goto('/').
const accountSaysLanguage = (mock, language) => mock.set({ user: { ...USER, language } });

// Unicode direction marks, built from char codes so this file stays plain ASCII.
const RLM = String.fromCharCode(0x200f); // right-to-left mark: first char of a sender line
const FSI = String.fromCharCode(0x2068); // first-strong isolate: opens the isolated time
const PDI = String.fromCharCode(0x2069); // pop directional isolate: closes it
const MIDDLE_DOT = ' ' + String.fromCharCode(0x00b7) + ' '; // separator between who and time

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
    await openSignUp(page, t);
    await expect(backButton(page, t)).toBeVisible();
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
    await openMenu(page, t);

    const panel = panelOf(page, t);
    // Hebrew item labels.
    await expect(page.getByText(t('menu:myRoutine'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('menu:settings'), { exact: true })).toBeVisible();

    // Mirroring proof: the panel opens on the right side, so its right edge touches the
    // viewport's right edge (and it is not at the left). The e2e browser uses reduced motion, so
    // the panel appears instantly (SideMenu.jsx prefersReducedMotion); poll() is just a safe net.
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
    await openMessages(page, t, 0);

    await expect(page.getByText(t('messages:subtitle'))).toBeVisible();
    await expect(backButton(page, t)).toBeVisible();

    // Sender lines look like: RLM + who + " middle-dot " + FSI + time + PDI (see senderLine()).
    // Find them by their isolate marks; the RLM must be the very first character.
    const senderLines = page.getByText(new RegExp(FSI + '.*' + PDI));
    await expect(senderLines.first()).toBeVisible();
    const all = await senderLines.allTextContents();
    expect(all.length).toBeGreaterThan(0);
    for (const line of all) {
      expect(line.startsWith(RLM)).toBe(true);
      expect(line).toContain(MIDDLE_DOT);
      // a non-empty, isolated time at the very end
      expect(line).toMatch(new RegExp(FSI + '[^' + PDI + ']+' + PDI + '$'));
    }
    // Both speakers use the Hebrew words for "you" / "the clinic".
    expect(all.some(x => x.includes(t('messages:you')))).toBe(true);
    expect(all.some(x => x.includes(t('messages:clinic')))).toBe(true);
  });

  test('Settings is in Hebrew including the Back label', async ({ page, t, mock }) => {
    mock.set({ unread: 0 });
    await openSettings(page, t);

    await expect(page.getByText(t('settings:remindersTitle'))).toBeVisible();
    await expect(backButton(page, t)).toBeVisible();
  });
});

// The language rule with a device language of 'he' and an account that says otherwise.
test.describe('device language he vs account language', () => {
  test.use({ signedIn: true });

  test('account language en wins over the device he (UI turns English, device key is kept)', async ({ page, t, mock }) => {
    const tEn = makeT('en');
    accountSaysLanguage(mock, 'en');
    await page.goto('/');
    // FIRST wait for the ENGLISH Home greeting. Until the account loads, the Splash spinner is
    // showing and <html> is already lang=en/dir=ltr (index.html default), so the html checks
    // below would pass vacuously. The English greeting appears only once the account won.
    await expect(page.getByText(tEn('home:greeting.morning'))).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // The Hebrew greeting is absent (the `t` fixture reads Hebrew in this file).
    await expect(page.getByText(t('home:greeting.morning'))).toHaveCount(0);
    // Booting never overwrites the stored device choice (languageSync: "writes nothing").
    const stored = await page.evaluate(() => localStorage.getItem('CapacitorStorage.app.language'));
    expect(stored).toBe('he');
  });

  test('account language he agrees with the device: Hebrew', async ({ page, t, mock }) => {
    accountSaysLanguage(mock, 'he');
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('an account with no language falls back to the device language: Hebrew', async ({ page, t, mock }) => {
    accountSaysLanguage(mock, null);
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
