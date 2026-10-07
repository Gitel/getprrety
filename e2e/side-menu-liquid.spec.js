// Tests for the "liquid" side menu (docs: AI/tasks/side-menu-liquid). Written test-first: they
// describe the NEW behaviour and fail on the old Modal-based menu.
//
// DOM contract (data-testid values the implementation must provide):
//   side-menu         overlay root, always on the page while signed in, display:none while closed
//   side-menu-dim     full-screen black layer, pointer-events none, darkness (alpha x opacity) <= 0.2
//   side-menu-reveal  holds the clip-path (wavy edge). Computed clip-path is 'none' when fully open.
//   The panel (aria-label "Menu") lives inside the reveal element.
// clip-path also clips hit testing, so "is this point revealed?" = "is the element under that
// point inside the reveal element?" (document.elementFromPoint).
//
// Animation tests assert PROPERTIES of a per-frame recording, never exact timings or frame counts.
import { test, expect } from './support/test.js';
import { openMenu, tapMenuItem, panelOf } from './support/nav.js';

// Installs, inside the page, window.__snap() (one measurement of the menu right now) and
// a recorder: from the next pointerdown it calls __snap on every animation frame for ~1.2 s
// and pushes the results into window.__samples.
// Install and arm BEFORE the tap, because the first frames after the tap are the interesting ones.
// Pass arm=false to only define __snap now and call page.evaluate(() => window.__arm()) later.
async function installSampler(page, t, rtl, arm = true) {
  await page.evaluate(({ rtl, panelLabel, settingsTitle }) => {
    // Product of this element's and all ancestors' computed opacity (a faded parent dims children).
    const effOpacity = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
    window.__snap = () => {
      const overlay = document.querySelector('[data-testid="side-menu"]');
      const reveal = document.querySelector('[data-testid="side-menu-reveal"]');
      const dim = document.querySelector('[data-testid="side-menu-dim"]');
      const displayed = !!overlay && getComputedStyle(overlay).display !== 'none';
      // Darkness = background alpha x effective opacity (0 when the overlay is not displayed).
      let darkness = 0;
      if (displayed && dim) {
        const m = getComputedStyle(dim).backgroundColor.match(/rgba?\(([^)]+)\)/);
        darkness = (m ? Number((m[1].split(',')[3] ?? '1').trim()) : 0) * effOpacity(dim);
      }
      // Revealed test at a point 6 px inside the panel's origin corner (top-left EN, top-right HE)
      // and at the opposite corner.
      const panel = (reveal || document).querySelector(`[aria-label="${panelLabel}"]`);
      const r = panel ? panel.getBoundingClientRect() : null;
      const revealedAt = (x, y) => {
        if (!displayed || !reveal) return false;
        const hit = document.elementFromPoint(x, y);
        return !!hit && reveal.contains(hit);
      };
      const originX = r ? (rtl ? r.right - 6 : r.left + 6) : 0;
      const farX = r ? (rtl ? r.left + 6 : r.right - 6) : 0;
      // The new screen's title counts only when it is OUTSIDE the overlay and really on screen.
      const settingsShowing = Array.from(document.querySelectorAll('*')).some((el) => {
        if (el.children.length || el.textContent !== settingsTitle || (overlay && overlay.contains(el))) return false;
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.right > 0 && b.left < window.innerWidth;
      });
      return {
        displayed, darkness,
        originRevealed: r ? revealedAt(originX, r.top + 6) : false,
        farRevealed: r ? revealedAt(farX, r.bottom - 6) : false,
        clip: reveal ? getComputedStyle(reveal).clipPath : null,
        panelRight: r ? r.right : null,
        settingsShowing,
      };
    };
    window.__samples = [];
    // Arms the recorder: it starts at the NEXT pointerdown (the tap under test).
    window.__arm = () => {
      window.__samples = [];
      document.addEventListener('pointerdown', () => {
        const end = performance.now() + 1200;
        const tick = () => { window.__samples.push(window.__snap()); if (performance.now() < end) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }, { capture: true, once: true });
    };
  }, { rtl, panelLabel: t('menu:panel'), settingsTitle: t('settings:title') });
  if (arm) await page.evaluate(() => window.__arm());
}
const snap = (page) => page.evaluate(() => window.__snap());
// Lets the 1.2 s recording finish, then returns every sampled frame.
async function samples(page) {
  await page.waitForTimeout(1400);
  return page.evaluate(() => window.__samples);
}
const overlay = (page) => page.getByTestId('side-menu');
const closeButtons = (page, t) => page.getByRole('button', { name: t('menu:close') });
// Waits for the open animation to finish (full panel visible, no clip).
const waitFullyOpen = (page) => expect.poll(async () => { const s = await snap(page); return s.displayed && s.clip === 'none' && s.farRevealed; }).toBe(true);

// ---------------------------------------------------------------- A: animations ON
test.describe('liquid menu animation', () => {
  test.use({ signedIn: true, contextOptions: { reducedMotion: 'no-preference' } });

  test('menu is already on the page (hidden) and opening reuses the same node', async ({ page, t }) => {
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(overlay(page)).toHaveCount(1);
    await expect(overlay(page)).toBeHidden();
    // Tag the panel node while hidden; if opening rebuilt it the tag would be gone.
    // page.locator (not panelOf/getByLabel): the shared fixture filters getByLabel to VISIBLE
    // elements, but here we must reach the panel while it is still hidden.
    await page.locator(`[aria-label="${t('menu:panel')}"]`).evaluate((el) => { el.dataset.e2eMark = '1'; });
    await openMenu(page, t);
    await expect(panelOf(page, t)).toHaveAttribute('data-e2e-mark', '1');
  });

  // Shared body for EN / HE: the page may never darken ahead of the reveal, and the reveal must
  // travel corner to corner (origin first, far corner later) instead of jumping.
  const openingFlow = (rtl) => async ({ page, t }) => {
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await installSampler(page, t, rtl);
    await page.getByRole('button', { name: t('menu:open') }).click();
    const frames = await samples(page);
    expect(frames.length).toBeGreaterThan(3);
    for (const f of frames) expect(f.darkness).toBeLessThanOrEqual(0.205);
    // Every visibly dark frame must already show the origin corner of the menu.
    for (const f of frames.filter((x) => x.darkness > 0.01)) expect(f.originRevealed).toBe(true);
    // At least one frame in the middle of the flow: origin revealed, far corner not yet.
    expect(frames.some((f) => f.originRevealed && !f.farRevealed)).toBe(true);
    // End state.
    await expect.poll(async () => (await snap(page)).clip).toBe('none');
    const end = await snap(page);
    expect(end.darkness).toBeCloseTo(0.2, 2);
    expect(end.farRevealed).toBe(true);
    // Hebrew panel sits on the right edge; English on the left.
    if (rtl) expect(end.panelRight).toBeCloseTo(page.viewportSize().width, 0);
    else expect(end.panelRight).toBeLessThan(page.viewportSize().width);
  };
  test('opening flows from the top-left corner (English)', openingFlow(false));
  test.describe('Hebrew', () => {
    test.use({ lang: 'he' });
    test('opening flows from the top-right corner (Hebrew)', openingFlow(true));
  });

  test('closing flows back instead of vanishing', async ({ page, t }) => {
    await page.goto('/');
    await installSampler(page, t, false, false);
    await openMenu(page, t);
    await waitFullyOpen(page);
    await page.evaluate(() => window.__arm());
    await closeButtons(page, t).last().click();
    const frames = await samples(page);
    expect(frames.some((f) => f.displayed && ((f.clip && f.clip !== 'none') || (f.originRevealed && !f.farRevealed)))).toBe(true);
    await expect(overlay(page)).toBeHidden();
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
  });

  test('picking Settings shows the new screen while the menu is still flowing back', async ({ page, t }) => {
    await page.goto('/');
    await installSampler(page, t, false, false);
    await openMenu(page, t);
    await waitFullyOpen(page);
    await page.evaluate(() => window.__arm());
    await tapMenuItem(page, t, 'menu:settings');
    const frames = await samples(page);
    expect(frames.some((f) => f.settingsShowing && f.displayed)).toBe(true);
    await expect(overlay(page)).toBeHidden();
    await expect(page.getByText(t('settings:title'), { exact: true }).filter({ visible: true })).toBeVisible();
  });
});

// ---------------------------------------------------------------- B: reduced motion (default)
test.describe('liquid menu with reduced motion', () => {
  test.use({ signedIn: true });

  test('opens and closes instantly', async ({ page, t }) => {
    await page.goto('/');
    await installSampler(page, t, false, false);
    await openMenu(page, t);
    const s = await snap(page);
    expect(s.clip).toBe('none');
    expect(s.darkness).toBeCloseTo(0.2, 2);
    await closeButtons(page, t).first().click();
    await expect(overlay(page)).toBeHidden({ timeout: 500 });
  });

  test('keyboard: focus enters the menu, Tab stays inside, Escape closes and returns focus', async ({ page, t }) => {
    await page.goto('/');
    await openMenu(page, t);
    const inside = () => page.evaluate(() => !!document.activeElement?.closest('[data-testid="side-menu"]'));
    await expect.poll(inside).toBe(true);
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); expect(await inside()).toBe(true); }
    for (let i = 0; i < 5; i++) { await page.keyboard.press('Shift+Tab'); expect(await inside()).toBe(true); }
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(t('menu:open'));
  });

  test('a closed menu is unreachable (not in the accessibility tree, not in the Tab order)', async ({ page, t }) => {
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(closeButtons(page, t)).toHaveCount(0);
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="side-menu"]'))).toBe(false);
    }
  });
});
