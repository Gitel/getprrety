// Baseline tests for the side (hamburger) menu and its language switch. They lock in what the
// app does TODAY. Source of truth: App.jsx (AppNavigator), src/components/SideMenu.jsx,
// src/lib/sideMenu.js (menuAction), src/lib/languageSync.js, src/lib/retake.js.
//
// The menu is rendered by react-native-web's Modal, i.e. in a portal at the end of <body>.
// Its panel is labelled t('menu:panel'), so menu rows are looked up INSIDE that panel; this
// keeps them apart from same-named things on the screen behind (e.g. Home's own message card).
import { test, expect } from './support/test.js';
import { makeT } from './support/i18n.js';
import { openMenu, tapMenuItem, panelOf } from './support/nav.js';
import { edgeSwipe } from './support/touch.js';

test.use({ signedIn: true });

// A translator for Hebrew, used after the language switch (the `t` fixture stays English).
const tHe = makeT('he');

// Home is recognised by its morning greeting (fixed clock: 09:00 UTC, user prefers morning).
const homeIsShowing = (page, t) => expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
const messagesIsShowing = (page, t) => expect(page.getByText(t('messages:title'), { exact: true })).toBeVisible();
const settingsIsShowing = (page, t) => expect(page.getByText(t('settings:title'), { exact: true })).toBeVisible();

test.describe('menu button', () => {
  test('is on Home, Messages, Settings and Profile (opened from Home)', async ({ page, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    const button = page.getByRole('button', { name: t('menu:open') });
    await expect(button).toBeVisible();

    // Messages (reached through the menu)
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:messages');
    await messagesIsShowing(page, t);
    await expect(button).toBeVisible();

    // Settings (hop from Messages)
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:settings');
    await settingsIsShowing(page, t);
    await expect(button).toBeVisible();

    // Back to Home, then Profile "opened from Home"
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:myRoutine');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:mySkinProfile');
    await expect(page.getByText(t('profile:cta'), { exact: true })).toBeVisible();
    await expect(button).toBeVisible();
  });

  test('is not on the quiz (an onboarding screen)', async ({ page, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:retake');
    await panelOf(page, t).getByText(t('menu:retakeYes'), { exact: true }).click();
    await expect(page.getByText(t('quiz:name.question'))).toBeVisible();
    await expect(page.getByRole('button', { name: t('menu:open') })).toHaveCount(0);
  });
});

test.describe('open and close', () => {
  test('lists the implemented items; the booking item shows when the server enables booking', async ({ page, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    const panel = panelOf(page, t);
    for (const key of [
      'menu:myRoutine', 'menu:mySkinProfile', 'menu:messages', 'menu:logProducts', 'menu:settings',
      'menu:book', 'menu:retake', 'menu:terms', 'menu:privacy', 'menu:logout', 'menu:language',
    ]) {
      await expect(panel.getByText(t(key), { exact: true })).toBeVisible();
    }
    // Each language option is drawn in its own language.
    await expect(panel.getByRole('button', { name: t('menu:languageName') })).toBeVisible();
    await expect(panel.getByRole('button', { name: tHe('menu:languageName') })).toBeVisible();
  });

  test('the booking item is hidden when the server has booking disabled', async ({ page, mock, t }) => {
    mock.booking({ enabled: false });
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    // The menu asks the server on every opening: wait for that answer before checking absence.
    await expect.poll(() => mock.callsTo('GET', '/api/bookings/config').length).toBeGreaterThan(0);
    const panel = panelOf(page, t);
    await expect(panel.getByText(t('menu:settings'), { exact: true })).toBeVisible();
    await expect(panel.getByText(t('menu:book'), { exact: true })).toHaveCount(0);
  });

  // The booking row depends on GET /api/bookings/config, asked on EVERY opening of the menu.
  const configCalls = mock => mock.callsTo('GET', '/api/bookings/config').length;
  const closeMenu = async (page, t) => {
    await page.getByRole('button', { name: t('menu:close') }).first().click();
    await expect(panelOf(page, t)).toBeHidden();
  };

  test('the booking config is fetched again on every opening', async ({ page, mock, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    await expect.poll(() => configCalls(mock)).toBe(1);
    await closeMenu(page, t);
    await openMenu(page, t);
    await expect.poll(() => configCalls(mock)).toBe(2);
    await expect(panelOf(page, t).getByText(t('menu:book'), { exact: true })).toBeVisible();
  });

  test('a late answer from an earlier opening is ignored', async ({ page, mock, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    // 1st opening: the answer ("enabled") is held back for 2 s.
    mock.delay('GET', '/api/bookings/config', 2000);
    await openMenu(page, t);
    await expect.poll(() => configCalls(mock)).toBe(1);
    await closeMenu(page, t);
    // 2nd opening: booking is now disabled and this answer is immediate.
    mock.booking({ enabled: false });
    await openMenu(page, t);
    await expect.poll(() => configCalls(mock)).toBe(2);
    const panel = panelOf(page, t);
    await expect(page.getByTestId('menu-book-placeholder')).toHaveCount(0);
    // Wait until the stale "enabled" answer has surely been delivered, then check it changed nothing.
    await page.waitForTimeout(2500);
    await expect(panel.getByText(t('menu:book'), { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('menu-book-placeholder')).toHaveCount(0);
  });

  test('an empty placeholder holds the booking row place until the answer arrives; nothing below moves', async ({ page, mock, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    mock.delay('GET', '/api/bookings/config', 1500);
    await openMenu(page, t);
    const panel = panelOf(page, t);
    const placeholder = page.getByTestId('menu-book-placeholder');
    const nextRow = panel.getByText(t('menu:logProducts'), { exact: true });

    // Waiting for the answer: the placeholder is there, the row is not.
    await expect(placeholder).toBeVisible();
    await expect(panel.getByText(t('menu:book'), { exact: true })).toHaveCount(0);
    const placeholderBox = await placeholder.boundingBox();
    const before = await nextRow.boundingBox();

    // The answer arrives: the placeholder is replaced by the real row.
    const book = panel.getByText(t('menu:book'), { exact: true });
    await expect(book).toBeVisible();
    await expect(placeholder).toHaveCount(0);
    const after = await nextRow.boundingBox();
    expect(after.y).toBe(before.y);
    // The real row has the same height as the placeholder that stood in for it.
    const rowBox = await panel.getByRole('button', { name: t('menu:book') }).boundingBox();
    expect(rowBox.height).toBe(placeholderBox.height);
  });

  test('the placeholder disappears when booking is disabled or the request fails', async ({ page, mock, t }) => {
    mock.booking({ enabled: false });
    mock.delay('GET', '/api/bookings/config', 800);
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    await expect(page.getByTestId('menu-book-placeholder')).toBeVisible();
    await expect(page.getByTestId('menu-book-placeholder')).toHaveCount(0);
    await closeMenu(page, t);
    // An error answer behaves like "disabled".
    mock.override('GET', '/api/bookings/config', 500, { error: 'boom' });
    await openMenu(page, t);
    await expect.poll(() => configCalls(mock)).toBe(2);
    await expect(page.getByTestId('menu-book-placeholder')).toHaveCount(0);
    await expect(panelOf(page, t).getByText(t('menu:book'), { exact: true })).toHaveCount(0);
  });

  // Only the FIRST opening of an app session has no answer yet and shows the placeholder; later
  // openings start from the last answer and re-fetch in the background.
  test('booking off: the first opening shows the placeholder; the second shows none and nothing moves', async ({ page, mock, t }) => {
    mock.booking({ enabled: false });
    mock.delay('GET', '/api/bookings/config', 800);
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    await expect(page.getByTestId('menu-book-placeholder')).toBeVisible();
    await expect(page.getByTestId('menu-book-placeholder')).toHaveCount(0);
    await closeMenu(page, t);

    // Second opening: slow answer again, but there is no placeholder and the rows stay put.
    mock.delay('GET', '/api/bookings/config', 800);
    await openMenu(page, t);
    const nextRow = panelOf(page, t).getByText(t('menu:logProducts'), { exact: true });
    const before = await nextRow.boundingBox();
    await expect(page.getByTestId('menu-book-placeholder')).toHaveCount(0);
    await expect.poll(() => configCalls(mock)).toBe(2);
    await page.waitForTimeout(1200); // the background answer has arrived by now
    expect((await nextRow.boundingBox()).y).toBe(before.y);
    await expect(page.getByTestId('menu-book-placeholder')).toHaveCount(0);
    await expect(panelOf(page, t).getByText(t('menu:book'), { exact: true })).toHaveCount(0);
  });

  test('booking on: the second opening shows the row at once, before the new answer', async ({ page, mock, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    await expect(panelOf(page, t).getByText(t('menu:book'), { exact: true })).toBeVisible();
    await closeMenu(page, t);
    mock.delay('GET', '/api/bookings/config', 1500);
    await openMenu(page, t);
    // Well inside the 1.5 s the new answer is held back: the row comes from the last answer.
    await expect(panelOf(page, t).getByText(t('menu:book'), { exact: true })).toBeVisible({ timeout: 700 });
    await expect(page.getByTestId('menu-book-placeholder')).toHaveCount(0);
    await expect.poll(() => configCalls(mock)).toBe(2);
  });

  test('the answer changes between openings: the second starts with the row, then it disappears', async ({ page, mock, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    const book = panelOf(page, t).getByText(t('menu:book'), { exact: true });
    await expect(book).toBeVisible();
    await closeMenu(page, t);
    mock.booking({ enabled: false });
    mock.delay('GET', '/api/bookings/config', 1000);
    await openMenu(page, t);
    await expect(book).toBeVisible();                       // last answer (enabled) shown first
    await expect(book).toHaveCount(0);                      // the new answer (disabled) wins
    await expect(page.getByTestId('menu-book-placeholder')).toHaveCount(0);
  });

  test('the X button, the backdrop and Escape all close it', async ({ page, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    const panel = panelOf(page, t);

    // X button in the panel header (the first "Close menu" button).
    await openMenu(page, t);
    await page.getByRole('button', { name: t('menu:close') }).first().click();
    await expect(panel).toBeHidden();

    // Backdrop = the dimmed area next to the panel (the last "Close menu" button).
    await openMenu(page, t);
    await page.getByRole('button', { name: t('menu:close') }).last().click();
    await expect(panel).toBeHidden();

    // Escape key (the Modal's onRequestClose).
    await openMenu(page, t);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    // Closing changed nothing: still on Home.
    await homeIsShowing(page, t);
  });

  test('the current screen row is marked aria-current="page"; tapping it only closes the menu', async ({ page, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    const panel = panelOf(page, t);
    // Exactly one row is current on Home: "My routine".
    await expect(panel.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(panel.locator('[aria-current="page"]')).toContainText(t('menu:myRoutine'));

    // Tapping it just closes the menu; we stay on Home.
    await tapMenuItem(page, t, 'menu:myRoutine');
    await expect(panel).toBeHidden();
    await homeIsShowing(page, t);

    // On Messages the current row moves to "Messages".
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:messages');
    await messagesIsShowing(page, t);
    await openMenu(page, t);
    await expect(panel.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(panel.locator('[aria-current="page"]')).toContainText(t('menu:messages'));
    await tapMenuItem(page, t, 'menu:messages');
    await expect(panel).toBeHidden();
    await messagesIsShowing(page, t);
  });
});

test.describe('edge swipe after menu navigation (swipe-back)', () => {
  // Proves the "replace" rule with the gesture: Messages -> Settings through the menu REPLACES
  // Messages (stack is [Home, Settings]), so one edge swipe lands on Home, not on Messages.
  test('Home -> Messages -> Settings via the menu, then the edge swipe lands on Home', async ({ page, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);

    // Home -> Messages: pushed on top of Home.
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:messages');
    await messagesIsShowing(page, t);
    await expect(panelOf(page, t)).toBeHidden(); // the menu closes when the screen changes

    // Messages -> Settings: REPLACES Messages (stack is [Home, Settings]).
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:settings');
    await settingsIsShowing(page, t);

    // Edge swipe (English: left edge, drag right, 60% of the width) lands on Home, NOT on Messages.
    await edgeSwipe(page, { lang: 'en', dx: 234 });
    await homeIsShowing(page, t);
    await expect(page.getByText(t('messages:title'), { exact: true })).toHaveCount(0);
  });
});

test.describe('navigation rule (menuAction)', () => {

  test('"My routine" from another screen pops back to Home', async ({ page, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:messages');
    await messagesIsShowing(page, t);
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:settings');
    await settingsIsShowing(page, t);
    // Home is the target: goBack() pops Settings and Home shows again.
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:myRoutine');
    await homeIsShowing(page, t);
    // The web build shows no stack depth, so this cannot prove HOW MANY screens were popped
    // (navigate('Home') would look the same). It only proves we ended on Home: the Home menu
    // marks "My routine" as current.
    await openMenu(page, t);
    await expect(panelOf(page, t).locator('[aria-current="page"]')).toContainText(t('menu:myRoutine'));
  });
});

test.describe('retake from the menu', () => {
  test('asks for confirmation inside the menu; Cancel keeps the menu and the screen', async ({ page, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    const panel = panelOf(page, t);
    await tapMenuItem(page, t, 'menu:retake');
    // The confirmation replaces the retake row, inside the same open menu.
    await expect(panel.getByText(t('menu:retakeConfirm'))).toBeVisible();
    await expect(panel.getByText(t('menu:retake'), { exact: true })).toHaveCount(0);

    await panel.getByText(t('common:cancel'), { exact: true }).click();
    await expect(panel.getByText(t('menu:retakeConfirm'))).toHaveCount(0);
    await expect(panel.getByText(t('menu:retake'), { exact: true })).toBeVisible();
  });

  test('confirming closes the menu and opens the quiz at the name question (consent is kept)', async ({ page, t }) => {
    await page.goto('/');
    await homeIsShowing(page, t);
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:retake');
    await panelOf(page, t).getByText(t('menu:retakeYes'), { exact: true }).click();
    // The fixture user has accepted the terms, so startRetake goes straight to Quiz (not
    // QuizIntro) and the quiz starts at the name question.
    await expect(page.getByText(t('quiz:name.question'))).toBeVisible();
    await expect(panelOf(page, t)).toBeHidden();
    await expect(page.getByText(t('home:greeting.morning'))).toHaveCount(0);
  });
});

test.describe('language switch', () => {
  test('English -> Hebrew -> reload -> English', async ({ page, mock, t }) => {
    const patches = () => mock.callsTo('PATCH', '/api/profile');
    const stored = () => page.evaluate(() => localStorage.getItem('CapacitorStorage.app.language'));

    await page.goto('/');
    await homeIsShowing(page, t);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await openMenu(page, t);
    const panelEn = panelOf(page, t);
    // English is the selected option at the start.
    await expect(panelEn.getByRole('button', { name: t('menu:languageName') })).toHaveAttribute('aria-pressed', 'true');
    expect(patches()).toHaveLength(0);

    // ---- English -> Hebrew ----
    await panelEn.getByRole('button', { name: tHe('menu:languageName') }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    // The menu stays open and its texts are now Hebrew.
    const panelHe = panelOf(page, tHe);
    await expect(panelHe).toBeVisible();
    await expect(panelHe.getByText(tHe('menu:settings'), { exact: true })).toBeVisible();
    await expect(panelHe.getByText(tHe('menu:logout'), { exact: true })).toBeVisible();
    await expect(panelHe.getByRole('button', { name: tHe('menu:languageName') })).toHaveAttribute('aria-pressed', 'true');
    await expect(panelHe.getByRole('button', { name: t('menu:languageName') })).toHaveAttribute('aria-pressed', 'false');
    // Chosen language is stored on the device and sent to the account (in the background).
    await expect.poll(stored).toBe('he');
    await expect.poll(() => patches().length).toBe(1);
    expect(patches()[0].body).toEqual({ language: 'he' });
    expect(patches()[0].authed).toBe(true);

    // Tapping the language already in use does nothing (no second PATCH is checked at the end).
    await panelHe.getByRole('button', { name: tHe('menu:languageName') }).click();
    await expect(panelHe).toBeVisible();

    // ---- reload keeps Hebrew ----
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.getByText(tHe('home:greeting.morning'))).toBeVisible();

    // ---- Hebrew -> English ----
    await openMenu(page, tHe);
    await panelOf(page, tHe).getByRole('button', { name: t('menu:languageName') }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(panelOf(page, t).getByText(t('menu:logout'), { exact: true })).toBeVisible();
    await expect.poll(stored).toBe('en');
    await expect.poll(() => patches().length).toBe(2);
    expect(patches()[1].body).toEqual({ language: 'en' });
  });
});
