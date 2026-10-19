// The Profile score section with the data of Daniel's mockup (plan AI/plans/score-page-match.md).
// Checks the parts that came from matching the mockup 1:1: the app fonts load, the bold shelf
// lead, the bold signal names in "Start here", the always-visible "+", the open/close animation
// (and none under reduced motion) and the striped "possible" band in both directions.
import { test, expect } from './support/test.js';
import { openProfileFromHome } from './support/nav.js';
import { ANALYSIS, MOCKUP_SKIN_SCAN } from './support/fixtures-data.js';

test.use({ signedIn: true });

// Profile with the mockup's numbers and copy. `change` edits a copy of the reading first.
async function openMockupProfile(page, mock, t, change) {
  const scan = structuredClone(MOCKUP_SKIN_SCAN);
  if (change) change(scan);
  mock.set({ analysis: { ...ANALYSIS, skinScan: scan } });
  await openProfileFromHome(page, t);
  await expect(page.getByText(t('score:title'))).toBeVisible();
}

const card = (page, t, key) => page.getByRole('button', { name: new RegExp(t(`score:signals.${key}`)) });
const fontWeight = locator => locator.evaluate(el => getComputedStyle(el).fontWeight);

// The animated box around an open card's content: the closest element with display: grid.
const collapseOf = locator => locator.evaluate(el => {
  let node = el;
  while (node && getComputedStyle(node).display !== 'grid') node = node.parentElement;
  return node ? getComputedStyle(node).transitionDuration : null;
});

test('the app fonts load under the names the styles use', async ({ page, mock, t }) => {
  await openMockupProfile(page, mock, t);
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family);
  });
  expect(loaded).toEqual(expect.arrayContaining(['DMSans_400Regular', 'DMSans_500Medium', 'CormorantGaramond_500Medium']));
});

test('"Start here" shows the signal names in bold', async ({ page, mock, t }) => {
  await openMockupProfile(page, mock, t);
  const name = page.getByText(t('score:signals.tone'), { exact: true }).first();
  await expect(name).toBeVisible();
  expect(Number(await fontWeight(name))).toBeGreaterThanOrEqual(600);
});

test('shelf lines: bold "Missing:" before a gap, bold first clause of an "own" line', async ({ page, mock, t }) => {
  await openMockupProfile(page, mock, t);

  await card(page, t, 'barrier').click();
  const missing = page.getByText(t('score:shelfMissing'), { exact: true });
  await expect(missing).toBeVisible();
  expect(Number(await fontWeight(missing))).toBeGreaterThanOrEqual(600);

  await card(page, t, 'clarity').click();
  const own = page.getByText('You already own a niacinamide serum', { exact: true });
  await expect(own).toBeVisible();
  expect(Number(await fontWeight(own))).toBeGreaterThanOrEqual(600);
});

test('the AI text already starting with "Missing:" is not labelled twice', async ({ page, mock, t }) => {
  await openMockupProfile(page, mock, t, scan => {
    scan.reading.signals[0].shelf.text = 'Missing: no moisturiser on your shelf.';
  });
  await card(page, t, 'barrier').click();
  await expect(page.getByText(t('score:shelfMissing'), { exact: true })).toHaveCount(1);
  await expect(page.getByText(/Missing:\s*Missing:/)).toHaveCount(0);
});

test('"+" is shown without a product link and does nothing when tapped', async ({ page, mock, t }) => {
  await openMockupProfile(page, mock, t, scan => { scan.reading.signals[0].product.url = null; });
  await card(page, t, 'barrier').click();
  const add = page.getByLabel(t('score:openProduct', { name: '⁨SR Barrier Repair Cream⁩' }));
  await expect(add).toBeVisible();
  const popups = [];
  page.context().on('page', p => popups.push(p));
  await add.click();
  expect(popups).toHaveLength(0);
  // The tap did not close the card either.
  await expect(card(page, t, 'barrier')).toHaveAttribute('aria-expanded', 'true');
});

test.describe('with motion', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('a card slides open and its content is removed after it slides closed', async ({ page, mock, t }) => {
    await openMockupProfile(page, mock, t);
    const driver = page.getByText(MOCKUP_SKIN_SCAN.reading.signals[0].driver);
    await card(page, t, 'barrier').click();
    await expect(driver).toBeVisible();
    expect(await collapseOf(driver)).toContain('0.45s');
    await card(page, t, 'barrier').click();
    await expect(card(page, t, 'barrier')).toHaveAttribute('aria-expanded', 'false');
    await expect(driver).toHaveCount(0);
  });
});

test('reduced motion: the card opens without a transition', async ({ page, mock, t }) => {
  await openMockupProfile(page, mock, t);
  const driver = page.getByText(MOCKUP_SKIN_SCAN.reading.signals[0].driver);
  await card(page, t, 'barrier').click();
  await expect(driver).toBeVisible();
  expect(await collapseOf(driver)).toBe('0s');
});

// The striped band starts where today's score ends: left-to-right in English, right-to-left in Hebrew.
for (const lang of ['en', 'he']) {
  test.describe(lang, () => {
    test.use({ lang });
    test(`the "possible" band starts at today's score (${lang})`, async ({ page, mock, t }) => {
      await openMockupProfile(page, mock, t);
      await card(page, t, 'barrier').click();
      const band = page.locator('div[style*="repeating-linear-gradient"]').first();
      await expect(band).toBeVisible();
      const { b, track } = await band.evaluate(el => ({
        b: el.getBoundingClientRect().toJSON(), track: el.parentElement.getBoundingClientRect().toJSON(),
      }));
      const now = MOCKUP_SKIN_SCAN.signals.signals[0].score / 100; // 72 -> 0.72
      const expected = lang === 'he' ? track.right - track.width * now : track.left + track.width * now;
      const edge = lang === 'he' ? b.right : b.left;
      expect(Math.abs(edge - expected)).toBeLessThan(2);
    });
  });
}
