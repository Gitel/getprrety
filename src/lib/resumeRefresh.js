import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

/**
 * Call `onResume` every time the app comes back to the foreground.
 *  - iOS / Android: Capacitor's App "resume" event. The webview's visibilitychange does
 *    not reliably fire on a native resume, which is why @capacitor/app was added.
 *  - Web: the page's visibilitychange (the tab became visible again).
 * Returns an unsubscribe function (for a React effect cleanup).
 * `deps` exists only so tests can inject fakes.
 */
export function onAppResume(onResume, deps = {}) {
  const { platform = Capacitor, app = App, doc = globalThis.document } = deps;

  if (platform.isNativePlatform()) {
    // addListener resolves to a handle; remove it once it exists.
    const handle = app.addListener('resume', () => onResume());
    return () => { Promise.resolve(handle).then(h => h && h.remove()).catch(() => {}); };
  }

  if (!doc) return () => {};
  const handler = () => { if (doc.visibilityState === 'visible') onResume(); };
  doc.addEventListener('visibilitychange', handler);
  return () => doc.removeEventListener('visibilitychange', handler);
}

/**
 * Decide which analysis to keep after re-reading GET /api/analysis/latest on resume.
 *
 * Right after a quiz, the in-memory analysis comes straight from the analysis service:
 * it has no `_id`, and its save to the server may still be running in the background.
 * The server's "latest" could then be the PREVIOUS reading, so an analysis without an
 * `_id` is never replaced. Once its save finishes, LoadingScreen / SignUpScreen attach
 * the saved `_id` (persistAnalysis withSavedId), and from then on resume refreshes apply.
 * Otherwise the server copy wins, because it carries any clinic edits.
 */
export function nextAnalysis(current, saved) {
  if (!saved) return current;
  if (current && !current._id) return current;
  return keepIfEqual(current, saved);
}

/**
 * Return `prev` when `next` holds the same data. React state updates with an equal but
 * new object would re-run effects that depend on it (e.g. the Profile screen asking
 * Claude for product picks again) on every single resume.
 */
export function keepIfEqual(prev, next) {
  if (prev === next) return prev;
  try {
    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
  } catch {
    return next;
  }
}
