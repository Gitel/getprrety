import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, QUESTIONS } from '../constants';

const Q = QUESTIONS.find(q => q.id === 'welcome');
// TESTING ONLY: T&C/privacy consent gate removed so the quiz can be entered without agreeing.
// Re-add the checkbox + LEGAL_READY gating (see git history) before shipping this to real users —
// signup still expects consentAcceptedAt/consentVersion, so re-wire that too if this ships as-is.
const CONSENT_VERSION = process.env.EXPO_PUBLIC_CONSENT_VERSION;

export default function QuizIntroScreen({ navigation }) {
  function begin() {
    navigation.navigate('Quiz', {
      consentAcceptedAt: new Date().toISOString(),
      consentVersion: CONSENT_VERSION,
    });
  }

  return (
    <SafeAreaView style={s.safe}>
      {navigation.canGoBack() && (
        <Pressable onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={10}>
          <Text style={s.backText}>← Back</Text>
        </Pressable>
      )}
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.moon}>🌙</Text>
        <View style={s.heroBlock}>
          <Text style={s.heading}>{Q.header}</Text>
          <Text style={s.sub}>{Q.body}</Text>
          <Text style={s.time}>{Q.timeNote}</Text>
        </View>

        <View style={s.actions}>
          <Pressable style={({ pressed }) => [s.cta, pressed && { opacity: 0.88 }]} onPress={begin}>
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
  backBtn: { position: 'absolute', top: 8, left: 20, zIndex: 10, paddingVertical: 8, paddingHorizontal: 4 },
  backText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.accent },
  content: { flexGrow: 1, paddingHorizontal: 32, paddingTop: 40, paddingBottom: 40, alignItems: 'center', justifyContent: 'center' },
  moon: { fontSize: 44, marginBottom: 22 },
  heroBlock: { alignItems: 'center', marginBottom: 24 },
  heading: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 28, color: C.text, textAlign: 'center', lineHeight: 38, marginBottom: 16 },
  sub: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 10 },
  time: { fontFamily: 'DMSans_400Regular', fontSize: 12.5, color: C.muted },
  actions: { width: '100%', gap: 12, marginBottom: 24 },
  cta: { backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  ctaText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
  ghostBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 26, paddingVertical: 13, alignItems: 'center' },
  ghostText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, letterSpacing: 0.5 },
  checklist: { fontFamily: 'DMSans_400Regular', fontSize: 11.5, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  footer: { fontFamily: 'DMSans_400Regular', fontSize: 10.5, color: C.muted, textAlign: 'center' },
});
