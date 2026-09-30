// Code that runs INSIDE the browser page before any app script (context.addInitScript).
// It must be fully self-contained: Playwright serialises the function and runs it in the page,
// so it cannot use imports or variables from this file.
//
// It makes the page deterministic:
//   1. clock starts at a fixed time and then keeps running (a frozen Date.now would break
//      React Native's JS animations, which compare Date.now() with their start time);
//   2. Math.random is seeded;
//   3. storage is seeded ONCE per tab (see below);
//   4. geolocation always answers "denied" at once (no permission prompt).

// The fixed "now" of every test: matches the dates in fixtures-data.js.
export const FIXED_ISO = '2026-09-29T09:00:00.000Z';

export function pageInit({ fixedIso, storage }) {
  // 1. Clock: starts at fixedIso, then advances with real elapsed time.
  const RealDate = Date;
  const start = RealDate.parse(fixedIso);
  const t0 = performance.now();
  const nowMs = () => start + Math.floor(performance.now() - t0);
  function FakeDate(...args) {
    if (!new.target) return new RealDate(nowMs()).toString(); // Date() called as a function
    return args.length ? new RealDate(...args) : new RealDate(nowMs());
  }
  Object.setPrototypeOf(FakeDate, RealDate);
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = nowMs;
  window.Date = FakeDate;

  // 2. Seeded Math.random (mulberry32) so random UI choices are the same every run.
  let seed = 123456789;
  Math.random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // 3. Seed localStorage once per TAB. The sessionStorage flag survives reloads of the same
  //    tab, so "log out, then reload" does not silently sign the user back in.
  //    Capacitor Preferences on the web stores keys as "CapacitorStorage.<key>".
  try {
    if (!sessionStorage.getItem('__e2eSeeded')) {
      Object.entries(storage).forEach(([k, v]) => localStorage.setItem(k, v));
      sessionStorage.setItem('__e2eSeeded', '1');
    }
  } catch { /* storage unavailable: ignore */ }

  // 4. Geolocation: fail immediately with PERMISSION_DENIED (code 1).
  try {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (_ok, fail) => { if (fail) fail({ code: 1, message: 'denied' }); },
        watchPosition: () => 0,
        clearWatch: () => {},
      },
    });
  } catch { /* ignore */ }
}

// Builds the storage entries to seed. signedIn -> the mock token; lang 'he' -> stored language.
// 'app.language' is DEVICE_KEY in src/lib/languageSync.js.
export function buildStorage({ signedIn, lang, token }) {
  const storage = {};
  if (signedIn) storage['CapacitorStorage.gp_token'] = token;
  if (lang === 'he') storage['CapacitorStorage.app.language'] = 'he';
  return storage;
}
