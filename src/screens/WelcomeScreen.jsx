import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';
import { WELCOME_VARIANTS, getWelcomeRef } from '../lib/welcomeVariants';

// Clinic / website entry screen. Shown before QuizIntro only when the app was opened
// with a recognized ?ref= param (see App.js). Carries the resolved ref forward as
// `referralSource` so it rides into the quiz answers and lands on the customer record.
// Login-first: the Terms/Privacy consent now lives on LoginScreen / SignUpScreen. This
// screen only forwards the stamp "Skip for now" put in the route params (anonymous
// users); signed-in users arrive without one.
export default function WelcomeScreen({ navigation, route }) {
  const { t } = useTranslation();
  const ref = route?.params?.ref || getWelcomeRef();
  const variant = ref ? WELCOME_VARIANTS[ref] : null;

  useEffect(() => {
    if (!variant) navigation.replace('QuizIntro');
  }, [variant]);

  if (!variant) return null;

  function begin() {
    navigation.navigate('Quiz', {
      consentAcceptedAt: route?.params?.consentAcceptedAt || null,
      consentVersion: route?.params?.consentVersion || null,
      referralSource: ref,
    });
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.emoji}>{variant.emoji}</Text>
        {/* Texts are looked up by the ref, e.g. onboarding:welcome.lu_clinic.title (run-time key on purpose) */}
        <Text style={s.title}>{t(`onboarding:welcome.${ref}.title`)}</Text>
        <Text style={s.desc}>{t(`onboarding:welcome.${ref}.desc`)}</Text>

        <Pressable
          style={({ pressed }) => [s.cta, pressed && s.ctaPressed]}
          onPress={begin}
        >
          <Text style={s.ctaText}>{t(`onboarding:welcome.${ref}.cta`)}</Text>
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
  desc:          { fontFamily: 'DMSans_400Regular', fontSize: 15, color: C.muted, textAlign: 'center', lineHeight: 24, marginBottom: 28 },
  cta:           { width: '100%', backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  ctaPressed:    { opacity: 0.85 },
  ctaText:       { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
});
