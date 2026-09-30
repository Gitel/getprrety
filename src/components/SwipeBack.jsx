import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isRTL } from '../lib/language';
import {
  SLOP_PX, SETTLE_MS, startsAtEdge, backDistance, shouldGoBack,
} from '../lib/swipeBack';

// How far back (ms) the finger speed is measured when the finger lifts.
const VELOCITY_WINDOW_MS = 150;
const MIN_STEP_MS = 8;

// True when the user asked the OS for less motion (copy of the check in SideMenu.jsx).
function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

// Edge swipe-back: a one-finger drag that starts at the screen edge and moves toward the middle
// goes back one screen (left edge in English, right edge in Hebrew).
//   enabled    false on screens that must not swipe back (see canSwipeBack in lib/swipeBack.js)
//   onBack     called to go back one screen
//   screenKey  changes whenever the screen changes; used to drop a half-finished gesture
//
// While a finger is down the screen is moved by writing straight to its DOM style (no React
// state), so dragging never re-renders. Those inline styles exist ONLY during a gesture.
export default function SwipeBack({ enabled, onBack, screenKey, children }) {
  const { i18n } = useTranslation();
  const rtl = isRTL(i18n.language);

  const outer = useRef(null);   // fixed frame; clips the moving screen while dragging
  const content = useRef(null); // the screen itself; this is what moves
  // Latest props, read by the listeners below (they are registered only once).
  const latest = useRef({ enabled, onBack, rtl });
  latest.current = { enabled, onBack, rtl };
  // Gesture state. phase: 'idle' | 'undecided' (finger down, direction not known yet) |
  // 'swiping' | 'ignored' (not ours: wait for the finger to lift) | 'settling' (animating out).
  const gesture = useRef({ phase: 'idle' });
  const timer = useRef(null);

  // Removes every inline style this component ever writes, so nothing is left behind.
  function clearStyles() {
    if (content.current) {
      content.current.style.transform = '';
      content.current.style.transition = '';
      content.current.style.boxShadow = '';
    }
    if (outer.current) outer.current.style.overflow = '';
  }

  // Back to "no gesture": cancel the pending timer and remove all inline styles.
  function resetGesture() {
    clearTimeout(timer.current);
    timer.current = null;
    gesture.current = { phase: 'idle' };
    clearStyles();
  }

  // A screen change in the middle of a gesture (e.g. a timer navigates) must not leave the new
  // screen shifted. Layout effect: runs before the browser paints.
  useLayoutEffect(() => { resetGesture(); }, [screenKey]);

  useEffect(() => {
    const node = outer.current;

    // Finger lifted (or gesture aborted): go back or spring back, then clean up.
    function finish(goBack) {
      const g = gesture.current;
      const { rtl: isRtl, onBack: back } = latest.current;
      g.phase = 'settling'; // ignore new touches until the animation is over
      if (prefersReducedMotion()) {
        // No animation: nothing was moved, so just act and reset.
        if (goBack) back();
        resetGesture();
        return;
      }
      content.current.style.transition = `transform ${SETTLE_MS}ms ease-out`;
      const target = goBack ? g.width : 0;
      content.current.style.transform = `translateX(${isRtl ? -target : target}px)`;
      // setTimeout (not transitionend): transitionend never fires in a hidden tab.
      timer.current = setTimeout(() => {
        // flushSync commits the popped-to screen now, so it is already on screen when the inline
        // styles are cleared (no flash of the old screen back at its resting place).
        if (goBack) flushSync(() => back());
        // Also covers a goBack that did nothing: the screen returns to rest either way.
        resetGesture();
      }, SETTLE_MS);
    }

    // A second finger arrived: abort the gesture (spring back if the screen was already moving).
    function abort() {
      if (gesture.current.phase === 'swiping') finish(false);
      else gesture.current = { phase: 'ignored' };
    }

    function onStart(event) {
      const g = gesture.current;
      if (g.phase === 'undecided' || g.phase === 'swiping') {
        if (event.touches.length > 1) abort();
        return;
      }
      if (g.phase !== 'idle') return;
      const { enabled: on, rtl: isRtl } = latest.current;
      if (!on || event.touches.length !== 1) return;
      const rect = node.getBoundingClientRect();
      const touch = event.touches[0];
      // Must begin in the edge strip, otherwise the whole gesture is not ours.
      if (!startsAtEdge(touch.clientX - rect.left, rect.width, isRtl)) return;
      gesture.current = {
        phase: 'undecided',
        startX: touch.clientX,
        startY: touch.clientY,
        width: rect.width,
        distance: 0,
        velocity: 0,
        samples: [{ d: 0, t: event.timeStamp || performance.now() }], // recent (distance, time) points
      };
    }

    function onMove(event) {
      const g = gesture.current;
      if (g.phase !== 'undecided' && g.phase !== 'swiping') return;
      if (event.touches.length !== 1) {
        abort();
        return;
      }
      const { rtl: isRtl } = latest.current;
      const touch = event.touches[0];
      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;

      if (g.phase === 'undecided') {
        // Claim horizontal movement right away so the browser cannot start a scroll instead.
        if (Math.abs(dx) >= Math.abs(dy) && event.cancelable) event.preventDefault();
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= SLOP_PX) return;
        // Past the slop: decide. Horizontal and toward the middle = ours, anything else is not.
        if (Math.abs(dx) >= Math.abs(dy) && backDistance(dx, isRtl) > 0) {
          g.phase = 'swiping';
        } else {
          gesture.current = { phase: 'ignored' };
          return;
        }
      }

      if (event.cancelable) event.preventDefault();
      g.distance = Math.min(Math.max(backDistance(dx, isRtl), 0), g.width);
      // Finger speed in px/ms = the larger of (a) the average speed over the last
      // VELOCITY_WINDOW_MS and (b) the fastest single step inside it. The average alone misses a
      // quick flick followed by slow events; one step alone is noisy. Steps shorter than
      // MIN_STEP_MS are skipped for (b) (timestamps are too coarse to divide by).
      const now = event.timeStamp || performance.now();
      g.samples.push({ d: g.distance, t: now });
      while (g.samples.length > 2 && now - g.samples[0].t > VELOCITY_WINDOW_MS) g.samples.shift();
      const oldest = g.samples[0];
      g.velocity = now > oldest.t ? (g.distance - oldest.d) / (now - oldest.t) : 0;
      for (let i = 1; i < g.samples.length; i += 1) {
        const step = g.samples[i].t - g.samples[i - 1].t;
        if (step >= MIN_STEP_MS) {
          g.velocity = Math.max(g.velocity, (g.samples[i].d - g.samples[i - 1].d) / step);
        }
      }

      if (prefersReducedMotion()) return; // no following; the decision happens on release
      // translateX is NOT mirrored by react-native-web, so flip the sign ourselves in RTL.
      content.current.style.transform = `translateX(${isRtl ? -g.distance : g.distance}px)`;
      content.current.style.boxShadow = '0 0 16px rgba(0, 0, 0, 0.25)';
      node.style.overflow = 'hidden';
    }

    function onEnd() {
      const g = gesture.current;
      if (g.phase === 'swiping') {
        finish(shouldGoBack({ distance: g.distance, width: g.width, velocity: g.velocity }));
      } else if (g.phase !== 'settling') {
        gesture.current = { phase: 'idle' };
      }
    }

    // Cancelled by the system (e.g. an incoming call): never go back, spring back.
    function onCancel() {
      const g = gesture.current;
      if (g.phase === 'swiping') finish(false);
      else if (g.phase !== 'settling') gesture.current = { phase: 'idle' };
    }

    // Native listeners (not React props): React's touch listeners are passive, and touchmove
    // must be non-passive so preventDefault() can stop the browser from scrolling.
    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchmove', onMove, { passive: false });
    node.addEventListener('touchend', onEnd);
    node.addEventListener('touchcancel', onCancel);
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onCancel);
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <View ref={outer} style={{ flex: 1 }}>
      <View ref={content} style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
