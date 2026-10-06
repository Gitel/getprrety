// Entry variants for the clinic / website welcome screen, keyed by the ?ref= query param.
// Only the structure lives here. The copy (title / desc / cta) is translated text in
// src/locales/<lang>/onboarding.json under welcome.<ref>.* (first draft - confirm final
// wording with Daniel/Lu before shipping). Adding a variant = add its key here AND its texts there.
export const WELCOME_VARIANTS = {
  lu_clinic: { emoji: '🌿' },
  website:   { emoji: '🌿' },
};

// Read and validate the ?ref= param from the current URL. Web-only — returns null on
// native (no URL) or when the value isn't a known variant.
export function getWelcomeRef() {
  try {
    if (typeof window === 'undefined' || !window.location || !window.location.search) return null;
    const ref = new URLSearchParams(window.location.search).get('ref');
    return ref && Object.prototype.hasOwnProperty.call(WELCOME_VARIANTS, ref) ? ref : null;
  } catch {
    return null;
  }
}

// Screen where a user with no saved analysis starts the quiz: the clinic WelcomeScreen
// when the app was opened with a known ?ref= (it is the only place the referral is
// captured), otherwise the generic QuizIntro. Used by LoginScreen (log-in without a
// saved analysis) and by the log-out handlers (SideMenu, Settings), which keep this
// landing beneath Login.
export function quizEntryScreen() {
  return getWelcomeRef() ? 'Welcome' : 'QuizIntro';
}
