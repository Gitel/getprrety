// Entry variants for the clinic / website welcome screen, keyed by the ?ref= query param.
// Copy is a first draft — confirm final wording with Daniel/Lu before shipping. The code
// structure doesn't change either way.
export const WELCOME_VARIANTS = {
  lu_clinic: {
    emoji: '🌿',
    title: "You're in the right place",
    desc: "Before your appointment with Lu, let's get to know your skin. Takes about 5 minutes — Lu will have your Skin Era and routine ready when you walk in.",
    cta: 'Start my Skin Reading',
  },
  website: {
    emoji: '🌿',
    title: "Let's find your Skin Era",
    desc: "Answer a few questions about your skin — takes about 5 minutes. We'll build your personalized routine right after.",
    cta: 'Start my Skin Reading',
  },
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
