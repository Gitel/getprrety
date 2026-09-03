import { Alert, Linking } from 'react-native';

// Single source of truth for the pre-quiz Terms/Privacy consent. Both entry points
// (QuizIntroScreen and the referral WelcomeScreen) show binding "by continuing you
// agree" copy and stamp the acceptance on CTA tap — there is no separate checkbox.
export const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL;
export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL;
export const CONSENT_VERSION = process.env.EXPO_PUBLIC_CONSENT_VERSION;

// Onboarding may only stamp a consent record when the legal links and the active
// policy version are actually configured — otherwise the server rejects signup and
// the stamp would be meaningless.
export const LEGAL_READY =
  /^https:\/\//i.test(TERMS_URL || '') &&
  /^https:\/\//i.test(PRIVACY_URL || '') &&
  Boolean(CONSENT_VERSION);

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

// Params to carry into the quiz so signup can record a versioned acceptance.
// Returns null when legal config is missing — callers must not proceed.
export function consentParams() {
  if (!LEGAL_READY) return null;
  return {
    consentAcceptedAt: new Date().toISOString(),
    consentVersion: CONSENT_VERSION,
  };
}
