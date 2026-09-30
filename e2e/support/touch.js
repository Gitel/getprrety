// Touch-gesture helpers for the edge swipe-back tests (ASCII only).
//
// Two ways to produce a one-finger touch, picked by browser:
//   - Chromium: a CDP session + Input.dispatchTouchEvent. These are real (trusted) touches,
//     exactly what a finger produces.
//   - WebKit: Playwright has no touch API there, so we build synthetic Touch / TouchEvent objects
//     inside the page and dispatch them on the element under the finger (bubbling, cancelable).
//
// The gesture is split into three primitives (touchStart, touchMove, touchEnd) so a test can stop
// MID-drag and look at the page; `swipe` runs all three with real-time delays between moves, which
// is what makes the finger's speed (px per ms) controllable.

const VIEWPORT_WIDTH = 390; // the phone viewport from playwright.config.js
const TOUCH_ID = 1;

// One CDP session per page (created lazily, reused by every primitive).
const cdpSessions = new WeakMap();

// 'chromium' | 'webkit' | 'firefox', read from the page's own browser.
function browserNameOf(page) {
  return page.context().browser().browserType().name();
}

async function cdpOf(page) {
  if (!cdpSessions.has(page)) cdpSessions.set(page, await page.context().newCDPSession(page));
  return cdpSessions.get(page);
}

// WebKit only: builds and dispatches one synthetic touch event inside the page.
// Why not `new Touch(...)`: Playwright's WebKit throws "Illegal constructor" for it, but the
// legacy document.createTouch / createTouchList factories work, and `new TouchEvent(...)`
// accepts the TouchList they return.
async function fireWebkit(page, type, { x, y }) {
  await page.evaluate(({ type, x, y, id }) => {
    // touchstart picks the element under the finger; later events reuse it, like a real finger
    // (touch events always target the element where the touch began).
    if (type === 'touchstart') window.__swipeTarget = document.elementFromPoint(x, y);
    const target = window.__swipeTarget;
    const touch = document.createTouch(window, target, id, x, y, x, y);
    const list = document.createTouchList(touch);
    const none = document.createTouchList();
    // On touchend the finger is gone: touches / targetTouches are empty, changedTouches has it.
    const ending = type === 'touchend';
    target.dispatchEvent(new TouchEvent(type, {
      touches: ending ? none : list,
      targetTouches: ending ? none : list,
      changedTouches: list,
      bubbles: true,
      cancelable: true,
    }));
  }, { type, x, y, id: TOUCH_ID });
}

// Finger goes down at (x, y).
export async function touchStart(page, { x, y }) {
  if (browserNameOf(page) === 'chromium') {
    const cdp = await cdpOf(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: TOUCH_ID }],
    });
    return;
  }
  await fireWebkit(page, 'touchstart', { x, y });
}

// Finger slides to (x, y) while still down.
export async function touchMove(page, { x, y }) {
  if (browserNameOf(page) === 'chromium') {
    const cdp = await cdpOf(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, id: TOUCH_ID }],
    });
    return;
  }
  await fireWebkit(page, 'touchmove', { x, y });
}

// Finger lifts at (x, y) (the last position).
export async function touchEnd(page, { x, y }) {
  if (browserNameOf(page) === 'chromium') {
    const cdp = await cdpOf(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await fireWebkit(page, 'touchend', { x, y });
}

// Points evenly spread from `from` to `to` (excluding `from`, including `to`).
function pathPoints(from, to, steps) {
  const points = [];
  for (let i = 1; i <= steps; i++) {
    points.push({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  }
  return points;
}

// Moves the finger along the path, waiting `stepDelayMs` of REAL time between moves.
// Speed = distance / (steps * stepDelayMs).
export async function dragAlong(page, from, to, { steps = 10, stepDelayMs = 16 } = {}) {
  for (const point of pathPoints(from, to, steps)) {
    await touchMove(page, point);
    if (stepDelayMs > 0) await page.waitForTimeout(stepDelayMs);
  }
}

// Whole gesture: touchstart at `from`, `steps` touchmoves to `to`, touchend.
export async function swipe(page, { from, to, steps = 10, stepDelayMs = 16 }) {
  await touchStart(page, from);
  await dragAlong(page, from, to, { steps, stepDelayMs });
  await touchEnd(page, to);
}

// Whole flick inside ONE page.evaluate, with EXPLICIT event timestamps (used by the flick test).
// Why: the app measures release speed from event.timeStamp over the last 150 ms. When every touch
// event is its own round trip from the test process, a loaded machine can put more than 150 ms
// between the last move and the release, and the app (correctly) reads "finger rested". Here all
// events are dispatched synchronously in the page and each one is given its own timeStamp
// (base + i * stepMs), so the app always sees the same gesture: e.g. 90 px over 16 ms, released 8 ms
// after the last move, whatever the machine load. These are synthetic (untrusted) events in BOTH
// browsers, which is fine because the rule under test is speed, not trusted input.
export async function flickInPage(page, { from, to, steps = 2, stepMs = 8 }) {
  await page.evaluate(({ from, to, steps, stepMs, id }) => {
    const target = document.elementFromPoint(from.x, from.y);
    // Build a one-finger touch list at (x, y). Chromium has `new Touch()`; WebKit throws "Illegal
    // constructor" there, so fall back to the legacy document.createTouch / createTouchList.
    const listAt = (x, y) => {
      try {
        return [new Touch({ identifier: id, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y })];
      } catch (error) {
        return document.createTouchList(document.createTouch(window, target, id, x, y, x, y));
      }
    };
    const base = performance.now();
    let index = 0;
    // Dispatches one event whose timeStamp is forced to base + index * stepMs.
    const fire = (type, x, y) => {
      const list = listAt(x, y);
      const ending = type === 'touchend';
      // On touchend the finger is gone: touches / targetTouches are empty, changedTouches has it.
      const none = Array.isArray(list) ? [] : document.createTouchList();
      const event = new TouchEvent(type, {
        touches: ending ? none : list,
        targetTouches: ending ? none : list,
        changedTouches: list,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'timeStamp', { value: base + index * stepMs });
      index += 1;
      target.dispatchEvent(event);
    };
    fire('touchstart', from.x, from.y);
    let last = from;
    for (let i = 1; i <= steps; i++) {
      last = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
      fire('touchmove', last.x, last.y);
    }
    fire('touchend', last.x, last.y); // released one stepMs after the last move
  }, { from, to, steps, stepMs, id: TOUCH_ID });
}

// Back-direction geometry for a language: English goes left -> right, Hebrew right -> left.
// Returns the start x (startInset px from the correct edge, or `startX` if given) and the
// signed direction of the drag (+1 right, -1 left).
export function edgeGeometry({ lang, startInset = 8, startX, width = VIEWPORT_WIDTH }) {
  const he = lang === 'he';
  const x0 = startX ?? (he ? width - startInset : startInset);
  return { x0, dir: he ? -1 : 1 };
}

// Start/move/end versions of the edge swipe (used for mid-drag checks).
// `dx` is how far the finger travels IN THE BACK DIRECTION (a positive number).
export function edgeSwipePlan({ lang, dx, y = 400, startInset = 8, startX, dy = 0 }) {
  const { x0, dir } = edgeGeometry({ lang, startInset, startX });
  return { from: { x: x0, y }, to: { x: x0 + dir * dx, y: y + dy } };
}

// Swipe in the back direction of `lang`, starting `startInset` px from the matching screen edge.
// Pass `startX` to start somewhere else (e.g. away from the edge or at the opposite edge).
// NOTE on WebKit: its touches are synthetic events. They never scroll the page and never produce
// a click, so iOS tap / scroll behaviour cannot be proven here and needs a check on a real device.
export async function edgeSwipe(page, { lang, dx, y = 400, steps = 10, stepDelayMs = 16, startInset = 8, startX, dy = 0 }) {
  await swipe(page, { ...edgeSwipePlan({ lang, dx, y, startInset, startX, dy }), steps, stepDelayMs });
}

// Same as edgeSwipe but starting at the OPPOSITE edge (right edge in English, left in Hebrew)
// and dragging in the back direction's opposite, i.e. away from that edge toward the middle.
export async function oppositeEdgeSwipe(page, { lang, dx, y = 400, steps = 10, stepDelayMs = 16, startInset = 8 }) {
  const he = lang === 'he';
  const x0 = he ? startInset : VIEWPORT_WIDTH - startInset;
  const dir = he ? 1 : -1;
  await swipe(page, { from: { x: x0, y }, to: { x: x0 + dir * dx, y }, steps, stepDelayMs });
}

export { VIEWPORT_WIDTH };
