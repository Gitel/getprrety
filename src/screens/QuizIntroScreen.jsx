import React, { useState } from 'react';
import { Alert, View, Text, Pressable, ScrollView, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, QUESTIONS } from '../constants';

const Q = QUESTIONS.find(q => q.id === 'welcome');
const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL;
const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL;
const CONSENT_VERSION = process.env.EXPO_PUBLIC_CONSENT_VERSION;
const LEGAL_READY = /^https:\/\//i.test(TERMS_URL || '')
  && /^https:\/\//i.test(PRIVACY_URL || '')
  && Boolean(CONSENT_VERSION);

export default function QuizIntroScreen({ navigation }) {
  const [agreed, setAgreed] = useState(false);

  function begin() {
    if (!agreed || !LEGAL_READY) return;
    navigation.navigate('Quiz', {
      consentAcceptedAt: new Date().toISOString(),
      consentVersion: CONSENT_VERSION,
    });
  }

  function openLegal(url) {
    if (!url) {
      Alert.alert('Legal documents unavailable', 'Terms and Privacy links must be configured before onboarding can continue.');
      return;
    }
    Linking.openURL(url).catch(() => Alert.alert('Could not open link', 'Please try again when you are online.'));
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.moon}>🌙</Text>
        <View style={s.heroBlock}>
          <Text style={s.heading}>{Q.header}</Text>
          <Text style={s.sub}>{Q.body}</Text>
          <Text style={s.time}>{Q.timeNote}</Text>
        </View>

        <Pressable style={s.termsRow} onPress={() => LEGAL_READY && setAgreed(value => !value)}>
          <View style={[s.checkbox, agreed && s.checkboxChecked]}>
            {agreed && <Text style={s.checkmark}>✓</Text>}
          </View>
          <Text style={s.termsText}>
            I agree to the{' '}
            <Text style={s.termsLink} onPress={() => openLegal(TERMS_URL)}>Terms of Use</Text>
            {' '}and{' '}
            <Text style={s.termsLink} onPress={() => openLegal(PRIVACY_URL)}>Privacy Policy</Text>, including the use of my answers and photos for the skin assessment.
          </Text>
        </Pressable>
        {!LEGAL_READY && (
          <Text style={s.legalError}>Terms and Privacy links are not configured. Onboarding is disabled.</Text>
        )}

        <View style={s.actions}>
          <Pressable
            disabled={!agreed || !LEGAL_READY}
            style={({ pressed }) => [s.cta, (!agreed || !LEGAL_READY) && s.ctaDisabled, pressed && agreed && LEGAL_READY && { opacity: 0.88 }]}
            onPress={begin}
          >
            <Text style={s.ctaText}>{Q.cta}</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Login')} style={s.ghostBtn}>
            <Text style={s.ghostText}>Already have an account? Log in</Text>
          </Pressable>
        </View>

        <Text style={s.checklist}>{Q.checklist.map(c => `✔ ${c}`).join('   ')}</Text>
        <Text style={s.footer}>{Q.footer}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  content: { flexGrow: 1, paddingHorizontal: 32, paddingTop: 40, paddingBottom: 40, alignItems: 'center', justifyContent: 'center' },
  moon: { fontSize: 44, marginBottom: 22 },
  heroBlock: { alignItems: 'center', marginBottom: 24 },
  heading: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 28, color: C.text, textAlign: 'center', lineHeight: 38, marginBottom: 16 },
  sub: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 10 },
  time: { fontFamily: 'DMSans_400Regular', fontSize: 12.5, color: C.muted },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 22 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxChecked: { backgroundColor: C.accent, borderColor: C.accent },
  checkmark: { fontSize: 12, color: '#FFF', fontWeight: '700' },
  termsText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, lineHeight: 18 },
  termsLink: { fontFamily: 'DMSans_500Medium', color: C.accent, textDecorationLine: 'underline' },
  legalError: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#C44B4B', textAlign: 'center', marginTop: -12, marginBottom: 20 },
  actions: { width: '100%', gap: 12, marginBottom: 24 },
  cta: { backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  ctaDisabled: { backgroundColor: '#D4CBC4' },
  ctaText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
  ghostBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 26, paddingVertical: 13, alignItems: 'center' },
  ghostText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, letterSpacing: 0.5 },
  checklist: { fontFamily: 'DMSans_400Regular', fontSize: 11.5, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  footer: { fontFamily: 'DMSans_400Regular', fontSize: 10.5, color: C.muted, textAlign: 'center' },
});
