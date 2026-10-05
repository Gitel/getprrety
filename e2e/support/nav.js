// Shared navigation helpers. The app has no URLs (it keeps its own in-memory screen stack),
// so a spec "navigates" by clicking through the UI. Every helper waits for its target screen
// to be visible before it returns, so the next line of the spec never runs too early.
//
// `t` is the translator fixture (or makeT('he') for Hebrew): pass the one that matches the
// language the app is currently showing.
import { expect } from './test.js';

// The open side-menu panel. exact:true matters: the plain text "Menu" is also a substring of
// the hamburger label "Open menu" / "Close menu".
export const panelOf = (page, t) => page.getByLabel(t('menu:panel'), { exact: true });

// Opens the side menu with the hamburger button of the screen that is showing.
export async function openMenu(page, t) {
  await page.getByRole('button', { name: t('menu:open') }).click();
  await expect(panelOf(page, t)).toBeVisible();
}

// Taps a menu row by its visible text, e.g. tapMenuItem(page, t, 'menu:settings'). The row is
// looked up INSIDE the panel, so it never matches same-named text on the screen behind.
export async function tapMenuItem(page, t, key) {
  await panelOf(page, t).getByText(t(key), { exact: true }).click();
}

// The Back control (the same text on every screen that has one).
export const backButton = (page, t) => page.getByText(t('common:back'), { exact: true });

// Boots the app and waits until Home is on screen (the greeting only renders once an analysis exists).
export async function openHome(page, t) {
  await page.goto('/');
  await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
}

// Home -> "View my full analysis" -> Profile (opened with fromHome: true).
export async function openProfileFromHome(page, t) {
  await openHome(page, t);
  await page.getByText(t('home:viewAnalysis.title')).click();
  await expect(page.getByText(t('profile:audit.title'))).toBeVisible();
}

// Boots on Home and opens Messages with the Home message button. Its label depends on the
// unread badge, so pass the number the mock shows (default 1, the fixture value).
export async function openMessages(page, t, unread = 1) {
  await page.goto('/');
  const label = unread ? t('home:messages.unread', { count: unread }) : t('home:messages.label');
  await page.getByLabel(label, { exact: true }).click();
  await expect(page.getByText(t('messages:title'), { exact: true })).toBeVisible();
}

// Boots on Home and opens Settings through the side menu.
export async function openSettings(page, t) {
  await page.goto('/');
  await openMenu(page, t);
  await tapMenuItem(page, t, 'menu:settings');
  await expect(page.getByText(t('settings:title'), { exact: true })).toBeVisible();
}

// Signed out: boots on the landing (QuizIntro, or the clinic Welcome when the URL has a ?ref=),
// taps its "Already have an account? Log in" control and waits for the Login screen.
// The locale string wraps the accent word in <accent> tags; those are markup, not visible text.
export async function openLogin(page, t) {
  await page.goto('/');
  const sentence = t('auth:login.haveAccount').replace(/<\/?accent>/g, '');
  await page.getByText(sentence, { exact: true }).click();
  await expect(page.getByText(t('auth:login.tagline'), { exact: true })).toBeVisible();
}
