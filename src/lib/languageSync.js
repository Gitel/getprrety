// Keeps the UI language, the device and the account in step (plan decisions D7 and D11).
//
// THE RULE (read this first):
//  - Two values live on the device (Capacitor Preferences):
//      app.language         = the last language the user EXPLICITLY chose on this device.
//      app.pendingLanguage  = a choice that is not saved to the account yet (e.g. we were offline).
//  - The UI language is: pending ?? account (user.language) ?? device ?? 'en'.
//  - Applying a language only calls i18n.changeLanguage. It never writes the device keys, so
//    signing in to an account never overwrites the device choice.
//  - Signed out there is no account: the UI is device ?? 'en'.
//  - Logout drops the pending value, so one person's choice is never pushed onto the next
//    person's account on a shared (clinic) tablet.
//  - Coming back to the app (resume) may retry a pending save, but NEVER changes the UI language.
//
// Every function takes optional injectable dependencies ({ storage, api, i18n }) so the tests can
// run in node with fakes. The app calls them without arguments and gets the real ones.
import { Preferences } from '@capacitor/preferences';
import { api as realApi } from './api';
import realI18n from './i18n';
import { DEFAULT_LANGUAGE, normalizeLanguage } from './language';

export const DEVICE_KEY = 'app.language';
export const PENDING_KEY = 'app.pendingLanguage';

// Real storage: a thin wrapper over Capacitor Preferences (same pattern as auth.js).
const realStorage = {
  get: async key => (await Preferences.get({ key })).value,
  set: (key, value) => Preferences.set({ key, value }),
  remove: key => Preferences.remove({ key }),
};

function withDefaults(deps = {}) {
  return {
    storage: deps.storage || realStorage,
    api: deps.api || realApi,
    i18n: deps.i18n || realI18n,
  };
}

// Reads one stored key. A storage failure must never break the app, so it reads as "not set".
async function readKey(storage, key) {
  try {
    return normalizeLanguage(await storage.get(key));
  } catch {
    return null;
  }
}

// Pure. Picks the UI language from the three sources; each one is normalized first, so an
// invalid value (e.g. 'fr') is skipped rather than blocking the next source.
export function resolveLanguage({ pending, account, device } = {}) {
  return normalizeLanguage(pending)
    || normalizeLanguage(account)
    || normalizeLanguage(device)
    || DEFAULT_LANGUAGE;
}

// Switches the UI, never throwing (a failing i18n must not break a sign-in).
async function applyUi(i18n, lang) {
  try {
    if (i18n.language !== lang) await i18n.changeLanguage(lang);
  } catch { /* the UI keeps its current language */ }
}

// Tries to save `lang` on the account. On success the pending marker is removed, but only if it
// still holds this same value (the user may have switched again while the request was running).
// Never throws.
async function patchAccount(lang, { storage, api }) {
  try {
    await api.patch('/api/profile', { language: lang });
  } catch {
    return false; // offline or server error: the pending marker stays for the next retry
  }
  try {
    if (await readKey(storage, PENDING_KEY) === lang) await storage.remove(PENDING_KEY);
  } catch { /* a leftover marker only causes one harmless extra PATCH later */ }
  return true;
}

// One retry at a time: boot and resume could otherwise both send the same PATCH.
let retryInFlight = null;

// If a choice is waiting to be saved, sends it again. Callers only use this while a user is
// signed in. Resolves (never rejects) and never changes the UI language.
export function retryPendingLanguage(deps) {
  if (retryInFlight) return retryInFlight;
  const d = withDefaults(deps);
  retryInFlight = (async () => {
    try {
      const pending = await readKey(d.storage, PENDING_KEY);
      if (!pending) return false; // nothing (valid) waiting
      return await patchAccount(pending, d);
    } catch {
      return false;
    } finally {
      retryInFlight = null;
    }
  })();
  return retryInFlight;
}

// Called after every successful sign-in (Login email/Google, SignUp email/Google).
// Applies pending ?? account ?? device ?? 'en' to the UI. Writes nothing.
export async function applyAccountLanguage(user, deps) {
  const d = withDefaults(deps);
  const pending = await readKey(d.storage, PENDING_KEY);
  const device = await readKey(d.storage, DEVICE_KEY);
  const lang = resolveLanguage({ pending, account: user && user.language, device });
  await applyUi(d.i18n, lang);
  return lang;
}

// App start. Order matters: read the stored keys, restore the session, apply the language, all
// BEFORE the caller flips authReady (so the first screen is already in the right language).
// `loadSession` is passed in (AppContext owns the timeout); its result is returned unchanged.
export async function bootLanguage(loadSession, deps) {
  const d = withDefaults(deps);
  // Reads never throw (they fall back to "not set"), so auth is never blocked by storage.
  const pending = await readKey(d.storage, PENDING_KEY);
  const device = await readKey(d.storage, DEVICE_KEY);

  const session = await loadSession();
  const user = session && session.user;

  // Signed out: there is no account and no pending choice to honour.
  const lang = user
    ? resolveLanguage({ pending, account: user.language, device })
    : resolveLanguage({ device });
  await applyUi(d.i18n, lang);

  // A choice made offline last time: try to save it now (not awaited by the boot).
  if (user && pending) retryPendingLanguage(d);
  return session;
}

// The language switch (side menu, T20). Order: UI first (instant), then remember it on the device,
// then try to save it on the account without making the user wait. Never throws.
export async function saveLanguage(lang, deps) {
  const d = withDefaults(deps);
  const chosen = normalizeLanguage(lang);
  if (!chosen) return false;
  await applyUi(d.i18n, chosen);
  try {
    await d.storage.set(DEVICE_KEY, chosen);
    await d.storage.set(PENDING_KEY, chosen);
  } catch { /* no device storage: the UI still switched; the PATCH below may still save it */ }
  patchAccount(chosen, d); // fire-and-forget: patchAccount never rejects
  return true;
}

// Called on logout: forget any unsaved choice and show the device language (or English).
export async function clearPendingOnLogout(deps) {
  const d = withDefaults(deps);
  try { await d.storage.remove(PENDING_KEY); } catch { /* ignore */ }
  const device = await readKey(d.storage, DEVICE_KEY);
  await applyUi(d.i18n, resolveLanguage({ device }));
}
