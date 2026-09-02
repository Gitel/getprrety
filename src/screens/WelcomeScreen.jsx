import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../constants';
import { WELCOME_VARIANTS, getWelcomeRef } from '../lib/welcomeVariants';

// Mirrors QuizIntroScreen: consent is auto-accepted on entry (T&C gate is currently
// off for testing — see QuizIntroScreen). ?ref= visitors skip QuizIntro entirely and
// go straight into the quiz, so that consent stamp has to be set here instead.
const CONSENT_VERSION = process.env.EXPO_PUBLIC_CONSENT_VERSION;

// Clinic / website entry screen. Shown before QuizIntro only when the app was opened
// with a recognized ?ref= param (see App.js). Carries the resolved ref forward as
// `referralSource` so it rides into the quiz answers and lands on the customer record.
export default function WelcomeScreen({ navigation, route }) {
  const ref = route?.params?.ref || getWelcomeRef();
  const variant = ref ? WELCOME_VARIANTS[ref] : null;

  useEffect(() => {
    if (!variant) navigation.replace('QuizIntro');
  }, [variant]);

  if (!variant) return null;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.emoji}>{variant.emoji}</Text>
        <Text style={s.title}>{variant.title}</Text>
        <Text style={s.desc}>{variant.desc}</Text>

        <Pressable
          style={({ pressed }) => [s.cta, pressed && s.ctaPressed]}
          onPress={() => navigation.navigate('Quiz', {
            consentAcceptedAt: new Date().toISOString(),
            consentVersion: CONSENT_VERSION,
            referralSource: ref,
          })}
        >
          <Text style={s.ctaText}>{variant.cta} →</Text>
        </Pressable>

        <Pressable onPress={() => navigation.navigate('Login')} style={s.loginLink}>
          <Text style={s.loginLinkText}>Already have an account? <Text style={s.loginLinkBold}>Log in</Text></Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: C.bg },
  container:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emoji:         { fontSize: 52, marginBottom: 22 },
  title:         { fontFamily: 'CormorantGaramond_500Medium', fontSize: 28, color: C.text, textAlign: 'center', lineHeight: 38, marginBottom: 16 },
  desc:          { fontFamily: 'DMSans_400Regular', fontSize: 15, color: C.muted, textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  cta:           { width: '100%', backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  ctaPressed:    { opacity: 0.85 },
  ctaText:       { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
  loginLink:     { marginTop: 32 },
  loginLinkText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted },
  loginLinkBold: { fontFamily: 'DMSans_500Medium', color: C.accent },
});
