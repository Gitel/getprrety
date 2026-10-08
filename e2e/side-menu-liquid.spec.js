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


// Records, after EVERY animation frame, whether the overlay shows the "open look" while it is
// closing: displayed + pointer-events none (the closing state) + reveal without clip + visible dim.
// The sampler above runs BEFORE the menu's own rAF callback, so it can never see the last frame.
// Here requestAnimationFrame is wrapped: our check is queued after the app's callback and after the
// microtasks React queues from it, i.e. it sees what the browser paints for that frame.
async function installFlashLog(page) {
  await page.evaluate(() => {
    window.__flashFrames = 0; // number of CLOSING frames the recorder saw
    window.__lastDim = null;
    window.__flashes = [];
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => orig((ts) => {
      cb(ts);
      const check = (depth) => queueMicrotask(() => {
        if (depth < 5) { check(depth + 1); return; }
        const o = document.querySelector('[data-testid="side-menu"]');
        const r = document.querySelector('[data-testid="side-menu-reveal"]');
        const d = document.querySelector('[data-testid="side-menu-dim"]');
        if (!o || !r || !d) return;
        const cs = getComputedStyle(o);
        // "Closing" = overlay displayed but not tappable (pointer-events none).
        if (cs.display === 'none' || cs.pointerEvents !== 'none') { window.__lastDim = null; return; }
        window.__flashFrames += 1; // frames watched while closing
        const dim = Number(getComputedStyle(d).opacity);
        // (a) reveal without clip, or any shadow band without clip. The bands are the reveal's
        //     siblings inside its parent.
        const bands = Array.from(r.parentElement.children).filter((el) => el !== r);
        const revealOpen = getComputedStyle(r).clipPath === 'none';
        const bandOpen = bands.some((bd) => getComputedStyle(bd).clipPath === 'none');
        // (b) dim opacity going UP between two closing frames (0.01 tolerance) is a dim flash.
        const dimUp = window.__lastDim != null && dim > window.__lastDim + 0.01;
        // dim opacity > 0.05 means darkness > 0.01 (the dim colour is 20% black).
        if ((revealOpen && dim > 0.05) || bandOpen || dimUp) window.__flashes.push(Math.round(ts));
        window.__lastDim = dim;
      });
      check(0);
    });
  });
}
// Overlay is fully open: no clip, dim at 20%, focus inside the overlay.
const expectFullyOpen = async (page) => {
  await expect.poll(async () => { const x = await snap(page); return x.displayed && x.clip === 'none' && Math.abs(x.darkness - 0.2) < 0.01; }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="side-menu"]'))).toBe(true);
};
// The transparent strip beside the panel (the last button inside the overlay, after the panel's X).
const strip = (page, t) => overlay(page).getByRole('button', { name: t('menu:close') }).last();
// The scrollable element inside the menu panel.
const scrollTopOfMenu = (page) => page.evaluate(() => {
  const panel = document.querySelector('[data-testid="side-menu-reveal"]');
  const sc = Array.from(panel.querySelectorAll('*')).find((el) => el.scrollHeight > el.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(el).overflowY));
  return sc ? sc.scrollTop : null;
});
const scrollMenuToBottom = (page) => page.evaluate(() => {
  const panel = document.querySelector('[data-testid="side-menu-reveal"]');
  const sc = Array.from(panel.querySelectorAll('*')).find((el) => el.scrollHeight > el.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(el).overflowY));
  sc.scrollTop = sc.scrollHeight;
  return sc.scrollTop;
});

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
    // While closing the overlay has pointer-events none, so elementFromPoint never hits the
    // reveal; the clip-path is the only meaningful "still flowing" signal here.
    expect(frames.some((f) => f.displayed && f.clip && f.clip !== 'none')).toBe(true);
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

  // Regression: the last frame of a close used to paint the fully open panel (inline clip and dim
  // cleared before display:none arrived one frame later).
  for (const how of ['the strip', 'picking Settings']) {
    test(`the end of the close never shows the open look (close via ${how})`, async ({ page, t }) => {
      await page.goto('/');
      await installSampler(page, t, false, false);
      await openMenu(page, t);
      await waitFullyOpen(page);
      await installFlashLog(page);
      if (how === 'the strip') await strip(page, t).click();
      else await tapMenuItem(page, t, 'menu:settings');
      await expect(overlay(page)).toBeHidden();
      const { frames, flashes } = await page.evaluate(() => ({ frames: window.__flashFrames, flashes: window.__flashes }));
      expect(frames).toBeGreaterThanOrEqual(1); // at least one CLOSING frame was watched (proves the recorder saw the close)
      expect(flashes).toEqual([]);
    });
  }

  // NOTE: in WebKit the second tap sometimes lands after the animation already finished (Playwright's
  // actionability wait delays it), so the two interrupt tests below are regression coverage of the
  // interrupt path that is mainly exercised in Chromium. Deliberately not hardened.
  test('tapping the page while the menu is closing reaches the page and re-opens the menu', async ({ page, t }) => {
    await page.goto('/');
    await installSampler(page, t, false, false);
    await openMenu(page, t);
    await waitFullyOpen(page);
    await strip(page, t).click();
    // Mid-close the overlay is not tappable, so this tap lands on the hamburger underneath.
    await page.getByRole('button', { name: t('menu:open') }).click();
    await expectFullyOpen(page);
  });

  test('closing while it is still opening, then reopening, ends fully open', async ({ page, t }) => {
    await page.goto('/');
    await installSampler(page, t, false, false);
    await page.getByRole('button', { name: t('menu:open') }).click();
    await strip(page, t).click(); // closes mid-opening
    await page.getByRole('button', { name: t('menu:open') }).click();
    await expectFullyOpen(page);
  });
});

// ---------------------------------------------------------------- A2: scroll reset on a short screen
// A short viewport makes the menu scroll. After close + reopen it must start at the top again.
for (const [label, motion] of [['reduced motion', 'reduce'], ['animations on', 'no-preference']]) {
  test.describe(`menu scroll reset (${label})`, () => {
    test.use({ signedIn: true, viewport: { width: 390, height: 420 }, contextOptions: { reducedMotion: motion } });

    test('reopens scrolled to the top', async ({ page, t }) => {
      await page.goto('/');
      await openMenu(page, t);
      await expect.poll(() => scrollTopOfMenu(page)).not.toBeNull(); // the menu really scrolls
      expect(await scrollMenuToBottom(page)).toBeGreaterThan(50);
      await page.keyboard.press('Escape');
      await expect(overlay(page)).toBeHidden();
      await openMenu(page, t);
      // One direct read right after openMenu returns (no poll): a reset that only happens after the
      // menu is already visible would be a visible jump and must fail here.
      expect(await scrollTopOfMenu(page)).toBe(0);
    });
  });
}

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
    // Install a one-shot capture listener BEFORE the click. At the first animation frame after the
    // click it records whether the overlay is still displayed. null = "not recorded yet".
    // Reduced motion: already display:none at that frame. An animated 300 ms close: still displayed.
    await page.evaluate(() => {
      window.__displayedNextFrame = null;
      document.addEventListener('click', () => {
        requestAnimationFrame(() => {
          const o = document.querySelector('[data-testid="side-menu"]');
          window.__displayedNextFrame = !!o && getComputedStyle(o).display !== 'none';
        });
      }, { capture: true, once: true });
    });
    await closeButtons(page, t).first().click();
    await expect.poll(() => page.evaluate(() => window.__displayedNextFrame)).toBe(false);
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
