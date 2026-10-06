// Pure swipe-back helpers (no imports, safe to use anywhere, including unit tests).
// The app keeps navigation as an array stack of { name, params }; only the top screen renders.
// The edge-swipe gesture and the Android Back button call goBack only when these rules allow it.

// A swipe must START within this many px of the start edge, so it never fights with
// horizontal scrolling or taps in the middle of the screen.
export const EDGE_PX = 24;
// Movement (px) before we decide whether the gesture is horizontal or vertical.
// Below this we do nothing, so a tiny finger wobble is not treated as a swipe.
export const SLOP_PX = 10;
// Dragging further than this share of the screen width commits the "back".
export const DISTANCE_RATIO = 0.35;
// A quick flick (px per ms) also commits, even when the drag was short.
export const FLICK_VELOCITY = 0.5;
// A flick must still travel at least this far, otherwise a fast tap would count as a flick.
export const FLICK_MIN_PX = 40;
// The flick speed is the average speed over the last 150 ms before the finger lifts.
// A shorter window measured the test-harness flick at ~0.45-0.55 px/ms (flaky around the
// 0.5 threshold), and per-step speeds are too noisy on real phones.
export const VELOCITY_WINDOW_MS = 150;
// Length (ms) of the slide-out / spring-back animation.
export const SETTLE_MS = 180;

// True when the top screen may be popped off the stack.
// Never throws: an empty stack or screens without a name simply return false/true safely.
export function canSwipeBack(stack) {
  // Nothing beneath the top screen means there is nowhere to go back to.
  if (!Array.isArray(stack) || stack.length < 2) return false;
  const top = stack[stack.length - 1]?.name;
  const beneath = stack[stack.length - 2]?.name;
  // Loading: the analysis is running; leaving would let its timers push Profile on top later.
  // Quiz: a retake clears the old analysis first, so backing out would leave no analysis at all.
  if (top === 'Loading' || top === 'Quiz') return false;
  // Going back onto Loading re-mounts it, which re-runs the AI analysis and saves a duplicate record.
  if (beneath === 'Loading') return false;
  return true;
}

// True when the touch began close enough to the start edge (left in English, right in Hebrew).
export function startsAtEdge(x, width, rtl) {
  return rtl ? x >= width - EDGE_PX : x <= EDGE_PX;
}

// Pixels moved in the "back" direction: to the right in English, to the left in Hebrew.
export function backDistance(dx, rtl) {
  return rtl ? -dx : dx;
}

// Average speed (px per ms) in the back direction over the last VELOCITY_WINDOW_MS before release.
// samples: [{ d, t }] oldest first, d = px moved in the back direction, t = timestamp in ms.
// endTime: the release timestamp in ms.
// Measuring up to the release time (not up to the last sample) means a finger that stopped
// before lifting gives ~0, so an old fast movement never counts as a flick (no stale speed).
export function releaseVelocity(samples, endTime) {
  if (!samples.length) return 0;
  const last = samples[samples.length - 1];
  // Oldest sample still inside the window; none inside = the finger was still, so use the last one.
  const anchor = samples.find(s => endTime - s.t <= VELOCITY_WINDOW_MS) || last;
  return endTime > anchor.t ? (last.d - anchor.d) / (endTime - anchor.t) : 0;
}

// Decides on release whether to complete the back navigation or spring back.
// distance: px moved in the back direction, width: screen width, velocity: px per ms.
export function shouldGoBack({ distance, width, velocity }) {
  if (distance > width * DISTANCE_RATIO) return true;
  return velocity > FLICK_VELOCITY && distance > FLICK_MIN_PX;
}
