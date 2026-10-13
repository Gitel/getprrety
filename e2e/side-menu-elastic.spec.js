// Tests for the "elastic" side menu (docs: AI/tasks/side-menu-elastic). Written test-first: they
// describe the NEW behaviour and fail on the old clip-path ("liquid") menu.
//
// DOM contract (data-testid values the implementation must provide):
//   side-menu        overlay root, always on the page while signed in, display:none while closed,
//                    pointer-events none while closing
//   side-menu-dim    full-screen layer, background rgba(0,0,0,0.2). Its opacity is the VISIBLE
//                    FRACTION of the panel, so the page is never darker than the menu is open.
//   side-menu-slide  the moving wrapper; holds the inline transform (translateX). Computed
//                    transform is 'none' when fully open. It contains the panel (aria-label
//                    t('menu:panel')) and the edge svg.
//   side-menu-edge   the <svg> strip on the panel's trailing edge (right in EN, left in HE).
//                    Inside: exactly one <path data-edge="fill"> and several <path data-edge="shadow">.
//                    The fill path draws one elastic bulge (about 40 px out while opening).
//   side-menu-rows   a View whose DIRECT CHILDREN are the rows that fade in (staggered) on open.
//                    On close the rows are NOT animated (they stay at opacity 1).
//
// What the per-frame sampler (__snap) measures:
//   visibleFraction  on-screen width of the panel / panel width (0 when not displayed)
//   darkness         dim background alpha x effective opacity
//   slideTransform   computed transform of the slide wrapper
//   bulgeOut         how far the fill path sticks out past the panel's straight edge
//                    (EN: fill.right - panel.right, HE: panel.left - fill.left). Flat edge = about 0.
//   rowOpacities     first / last / min opacity of the rows, rowTransformsNone = no row is offset
//
// Animation tests assert PROPERTIES of a per-frame recording, never exact timings or frame counts.
// Frames sampled before the animation starts (not displayed yet) are tolerated.
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
      const slide = document.querySelector('[data-testid="side-menu-slide"]');
      const dim = document.querySelector('[data-testid="side-menu-dim"]');
      const rows = document.querySelector('[data-testid="side-menu-rows"]');
      const fill = document.querySelector('[data-testid="side-menu-edge"] path[data-edge="fill"]');
      const displayed = !!overlay && getComputedStyle(overlay).display !== 'none';
      // Darkness = background alpha x effective opacity (0 when the overlay is not displayed).
      let darkness = 0;
      if (displayed && dim) {
        const m = getComputedStyle(dim).backgroundColor.match(/rgba?\(([^)]+)\)/);
        darkness = (m ? Number((m[1].split(',')[3] ?? '1').trim()) : 0) * effOpacity(dim);
      }
      // Panel rect and how much of it is on screen.
      const panel = slide ? slide.querySelector(`[aria-label="${panelLabel}"]`) : null;
      const r = panel ? panel.getBoundingClientRect() : null;
      const vw = window.innerWidth;
      const visibleFraction = displayed && r && r.width > 0
        ? Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) / r.width : 0;
      // How far the elastic edge sticks out past the panel's straight edge (null if not measurable).
      let bulgeOut = null;
      if (r && fill) {
        const f = fill.getBoundingClientRect();
        bulgeOut = rtl ? r.left - f.left : f.right - r.right;
      }
      // Row opacities: direct children of the rows container.
      const rowEls = rows ? Array.from(rows.children) : [];
      const ops = rowEls.map((el) => Number(getComputedStyle(el).opacity));
      // The new screen's title counts only when it is OUTSIDE the overlay and really on screen.
      const settingsShowing = Array.from(document.querySelectorAll('*')).some((el) => {
        if (el.children.length || el.textContent !== settingsTitle || (overlay && overlay.contains(el))) return false;
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.right > 0 && b.left < window.innerWidth;
      });
      return {
        displayed, darkness, visibleFraction, bulgeOut, settingsShowing,
        slideTransform: slide ? getComputedStyle(slide).transform : null,
        panelLeft: r ? r.left : null,
        panelRight: r ? r.right : null,
        rowCount: rowEls.length,
        rowFirst: ops.length ? ops[0] : null,
        rowLast: ops.length ? ops[ops.length - 1] : null,
        rowMin: ops.length ? Math.min(...ops) : null,
        rowTransformsNone: rowEls.length > 0 && rowEls.every((el) => getComputedStyle(el).transform === 'none'),
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
// Waits for the open animation to finish (panel fully on screen, no slide offset left).
const waitFullyOpen = (page) => expect.poll(async () => { const s = await snap(page); return s.displayed && s.slideTransform === 'none' && s.visibleFraction > 0.99; }).toBe(true);

// Records, after EVERY animation frame, the state of a CLOSING overlay and logs a "flash" when the
// close ever looks MORE open than the frame before it (panel or dim growing), or when the slide
// wrapper goes back to transform 'none' (the fully open look) after it already moved.
// The sampler above runs BEFORE the menu's own rAF callback, so it can never see the last frame.
// Here requestAnimationFrame is wrapped: our check is queued after the app's callback and after the
// microtasks React queues from it, i.e. it sees what the browser paints for that frame.
async function installFlashLog(page) {
  await page.evaluate(() => {
    window.__flashFrames = 0; // number of CLOSING frames the recorder saw
    window.__prev = null;     // previous closing frame: { vf, dim, moved }
    window.__flashes = [];
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => orig((ts) => {
      cb(ts);
      const check = (depth) => queueMicrotask(() => {
        if (depth < 5) { check(depth + 1); return; }
        const o = document.querySelector('[data-testid="side-menu"]');
        const sl = document.querySelector('[data-testid="side-menu-slide"]');
        const d = document.querySelector('[data-testid="side-menu-dim"]');
        if (!o || !sl || !d) return;
        const cs = getComputedStyle(o);
        // "Closing" = overlay displayed but not tappable (pointer-events none).
        if (cs.display === 'none' || cs.pointerEvents !== 'none') { window.__prev = null; return; }
        window.__flashFrames += 1; // frames watched while closing
        const dim = Number(getComputedStyle(d).opacity);
        const tf = getComputedStyle(sl).transform;
        // Visible fraction of the slide wrapper (the panel fills it except for the edge strip).
        const b = sl.getBoundingClientRect();
        const vf = b.width > 0 ? Math.max(0, Math.min(b.right, window.innerWidth) - Math.max(b.left, 0)) / b.width : 0;
        const p = window.__prev;
        const grew = p && (vf > p.vf + 0.01 || dim > p.dim + 0.01);
        const backToOpen = p && p.moved && tf === 'none';
        if (grew || backToOpen) window.__flashes.push(Math.round(ts));
        window.__prev = { vf, dim, moved: p ? (p.moved || tf !== 'none') : tf !== 'none' };
      });
      check(0);
    });
  });
}
// Overlay is fully open: no slide offset, dim at 20%, focus inside the overlay.
const expectFullyOpen = async (page) => {
  await expect.poll(async () => { const x = await snap(page); return x.displayed && x.slideTransform === 'none' && Math.abs(x.darkness - 0.2) < 0.01; }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="side-menu"]'))).toBe(true);
};
// The transparent strip beside the panel (the last button inside the overlay, after the panel's X).
const strip = (page, t) => overlay(page).getByRole('button', { name: t('menu:close') }).last();
// The scrollable element inside the menu panel.
const scrollTopOfMenu = (page) => page.evaluate(() => {
  const panel = document.querySelector('[data-testid="side-menu-slide"]');
  const sc = Array.from(panel.querySelectorAll('*')).find((el) => el.scrollHeight > el.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(el).overflowY));
  return sc ? sc.scrollTop : null;
});
const scrollMenuToBottom = (page) => page.evaluate(() => {
  const panel = document.querySelector('[data-testid="side-menu-slide"]');
  const sc = Array.from(panel.querySelectorAll('*')).find((el) => el.scrollHeight > el.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(el).overflowY));
  sc.scrollTop = sc.scrollHeight;
  return sc.scrollTop;
});

// ---------------------------------------------------------------- A: animations ON
test.describe('elastic menu animation', () => {
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

  // Opens the menu with the hamburger and returns the 1.2 s recording (shared by several tests).
  const recordOpening = async (page, t, rtl) => {
    await page.goto('/');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await installSampler(page, t, rtl);
    await page.getByRole('button', { name: t('menu:open') }).click();
    const frames = await samples(page);
    expect(frames.length).toBeGreaterThan(3);
    return frames;
  };

  // Shared bodies for EN / HE (rtl mirrors everything).
  const slidesInFlow = (rtl) => async ({ page, t }) => {
    const frames = await recordOpening(page, t, rtl);
    const shown = frames.filter((f) => f.displayed);
    expect(shown.length).toBeGreaterThan(1);
    // The panel only moves inward (EN: right edge never decreases, HE: left edge never increases),
    // so it never overshoots or jumps back. 1 px tolerance for rounding.
    for (let i = 1; i < shown.length; i++) {
      if (rtl) expect(shown[i].panelLeft).toBeLessThanOrEqual(shown[i - 1].panelLeft + 1);
      else expect(shown[i].panelRight).toBeGreaterThanOrEqual(shown[i - 1].panelRight - 1);
    }
    // At least one frame in the middle of the slide.
    expect(shown.some((f) => f.visibleFraction > 0.05 && f.visibleFraction < 0.95)).toBe(true);
    // The page is never darker than the menu is open.
    for (const f of frames) {
      expect(f.darkness).toBeLessThanOrEqual(0.205);
      expect(f.darkness).toBeLessThanOrEqual(0.2 * f.visibleFraction + 0.02);
    }
    // End state.
    await expect.poll(async () => (await snap(page)).slideTransform).toBe('none');
    const end = await snap(page);
    expect(end.darkness).toBeCloseTo(0.2, 2);
    expect(end.bulgeOut).not.toBeNull();
    expect(Math.abs(end.bulgeOut)).toBeLessThan(1);
    // Hebrew panel sits on the right edge; English on the left.
    if (rtl) expect(end.panelRight).toBeCloseTo(page.viewportSize().width, 0);
    else expect(end.panelRight).toBeLessThan(page.viewportSize().width);
  };
  const bulgesInFlow = (rtl) => async ({ page, t }) => {
    const frames = await recordOpening(page, t, rtl);
    expect(frames.some((f) => f.bulgeOut != null && f.bulgeOut >= 20)).toBe(true);
  };
  const rowsStaggerFlow = (rtl) => async ({ page, t }) => {
    const frames = await recordOpening(page, t, rtl);
    // First row already (more) visible while the last one is still fading in.
    expect(frames.some((f) => f.rowFirst != null && f.rowLast != null && f.rowFirst - f.rowLast >= 0.3)).toBe(true);
    // End state: every row fully visible and back at its place.
    await expect.poll(async () => { const s = await snap(page); return s.rowCount > 0 && s.rowMin >= 0.99 && s.rowTransformsNone; }).toBe(true);
  };
  test('opening slides in from the left (English)', slidesInFlow(false));
  test('the edge bulges while opening (English)', bulgesInFlow(false));
  test('rows stagger in (English)', rowsStaggerFlow(false));
  test.describe('Hebrew', () => {
    test.use({ lang: 'he' });
    test('opening slides in from the right (Hebrew)', slidesInFlow(true));
    test('the edge bulges while opening (Hebrew)', bulgesInFlow(true));
    test('rows stagger in (Hebrew)', rowsStaggerFlow(true));
  });

  test('closing slides out instead of vanishing', async ({ page, t }) => {
    await page.goto('/');
    await installSampler(page, t, false, false);
    await openMenu(page, t);
    await waitFullyOpen(page);
    await page.evaluate(() => window.__arm());
    await closeButtons(page, t).last().click();
    const frames = await samples(page);
    const shown = frames.filter((f) => f.displayed);
    // At least one frame in the middle of the slide out.
    expect(shown.some((f) => f.visibleFraction > 0.05 && f.visibleFraction < 0.95)).toBe(true);
    // The panel and the dim only shrink while closing (0.01 / 0.005 tolerance for rounding).
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i].visibleFraction).toBeLessThanOrEqual(shown[i - 1].visibleFraction + 0.01);
      expect(shown[i].darkness).toBeLessThanOrEqual(shown[i - 1].darkness + 0.005);
    }
    // No stagger on close: rows stay at opacity 1 while the panel leaves.
    for (const f of shown) {
      expect(f.rowMin).not.toBeNull();
      expect(f.rowMin).toBeGreaterThanOrEqual(0.99);
    }
    await expect(overlay(page)).toBeHidden();
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
  });

  test('picking Settings shows the new screen while the menu is still leaving', async ({ page, t }) => {
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

  // Regression: the last frame of a close used to paint the fully open panel (inline style and dim
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
test.describe('elastic menu with reduced motion', () => {
  test.use({ signedIn: true });

  test('opens and closes instantly', async ({ page, t }) => {
    await page.goto('/');
    await installSampler(page, t, false, false);
    await openMenu(page, t);
    const s = await snap(page);
    // Everything is in its final state right away: no slide, full dim, rows visible, flat edge.
    expect(s.slideTransform).toBe('none');
    expect(s.darkness).toBeCloseTo(0.2, 2);
    expect(s.rowMin).toBeGreaterThanOrEqual(0.99);
    expect(s.bulgeOut).not.toBeNull();
    expect(Math.abs(s.bulgeOut)).toBeLessThan(1);
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
