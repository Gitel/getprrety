import { Alert, Linking } from 'react-native';

// Single source of truth for the Terms/Privacy consent. Signed-out users accept on the
// quiz landing (QuizIntro / Welcome): the "by continuing you agree" copy is shown there
// and the stamp is taken when the start button is tapped, then travels with the quiz
// answers. SignUp (email/Google) and Login's Google button send a fresh stamp because
// the server requires one (<= 24 h old) for new accounts. There is no separate checkbox.
export const TERMS_URL = process.env.VITE_TERMS_URL;
export const PRIVACY_URL = process.env.VITE_PRIVACY_URL;
export const CONSENT_VERSION = process.env.VITE_CONSENT_VERSION;

// Onboarding may only stamp a consent record when the legal links and the active
// policy version are actually configured — otherwise the server rejects signup and
// the stamp would be meaningless.
//
// Returned as a list rather than a boolean so the disabled-onboarding message can
// name what is actually unset. LEGAL_READY is derived from it, so the gate and the
// explanation can never disagree.
export function missingLegalConfig() {
  const missing = [];
  if (!/^https:\/\//i.test(TERMS_URL || '')) missing.push('Terms link');
  if (!/^https:\/\//i.test(PRIVACY_URL || '')) missing.push('Privacy link');
  if (!CONSENT_VERSION) missing.push('consent version');
  return missing;
}

export const LEGAL_READY = missingLegalConfig().length === 0;

export function openLegal(url) {
  if (!url) {
    Alert.alert(
      'Legal documents unavailable',
      'Terms and Privacy links must be configured before onboarding can continue.',
    );
    return;
  }
  Linking.openURL(url).catch(() =>
    Alert.alert('Could not open link', 'Please try again when you are online.'),
  );
}

// A fresh, versioned acceptance stamp: sent with sign-up / Google sign-in (the server
// requires it for new accounts), and taken on the landing start button so it can
// travel with the quiz answers.
// Returns null when legal config is missing — callers must not proceed.
export function consentParams() {
  if (!LEGAL_READY) return null;
  return {
    consentAcceptedAt: new Date().toISOString(),
    consentVersion: CONSENT_VERSION,
  };
}
