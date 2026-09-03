import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { C } from '../constants';
import { TERMS_URL, PRIVACY_URL, LEGAL_READY, openLegal } from '../lib/consent';

// Binding consent copy shown above the entry CTA on QuizIntroScreen and WelcomeScreen.
// Tapping the CTA is the act of acceptance; this text makes that explicit and links
// out to the policies. When legal links aren't configured, onboarding is blocked and
// we say so instead.
export default function ConsentNotice({ style }) {
  if (!LEGAL_READY) {
    return (
      <Text style={[s.error, style]}>
        Terms and Privacy links are not configured. Onboarding is disabled.
      </Text>
    );
  }
  return (
    <Text style={[s.text, style]}>
      By continuing, you agree to our{' '}
      <Text style={s.link} onPress={() => openLegal(TERMS_URL)}>Terms of Use</Text>
      {' '}and{' '}
      <Text style={s.link} onPress={() => openLegal(PRIVACY_URL)}>Privacy Policy</Text>
      , including the use of your answers and photos for the skin assessment.
    </Text>
  );
}

const s = StyleSheet.create({
  text: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: C.muted,
    lineHeight: 18,
    textAlign: 'center',
  },
  link: { fontFamily: 'DMSans_500Medium', color: C.accent, textDecorationLine: 'underline' },
  error: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#C44B4B',
    textAlign: 'center',
  },
});
