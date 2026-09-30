import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';

// Login-first: the Terms/Privacy consent now lives on LoginScreen / SignUpScreen, so
// this screen no longer shows or stamps it. It only forwards the stamp that "Skip for
// now" put in the route params (anonymous users); signed-in users arrive without one.
export default function QuizIntroScreen({ navigation, route }) {
  const { t } = useTranslation();
  // The intro copy lives in quiz.json under the "welcome" question id (quiz:welcome.*). The checklist is a list, so its key uses backticks: the static-key test only checks plain-string keys.
  const checklist = t(`quiz:welcome.checklist`, { returnObjects: true });
  function begin() {
    navigation.navigate('Quiz', {
      consentAcceptedAt: route?.params?.consentAcceptedAt || null,
      consentVersion: route?.params?.consentVersion || null,
      referralSource: route?.params?.referralSource || null,
    });
  }

  return (
    <SafeAreaView style={s.safe}>
      {navigation.canGoBack() && (
        <Pressable onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={10}>
          <Text style={s.backText}>{t('common:back')}</Text>
        </Pressable>
      )}
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.moon}>🌙</Text>
        <View style={s.heroBlock}>
          <Text style={s.heading}>{t('quiz:welcome.header')}</Text>
          <Text style={s.sub}>{t('quiz:welcome.body')}</Text>
          <Text style={s.time}>{t('quiz:welcome.timeNote')}</Text>
        </View>

        <View style={s.actions}>
          <Pressable
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.88 }]}
            onPress={begin}
          >
            <Text style={s.ctaText}>{t('quiz:welcome.cta')}</Text>
          </Pressable>
        </View>

        <Text style={s.checklist}>{checklist.map(c => `✔ ${c}`).join('   ')}</Text>
        <Text style={s.footer}>{t('quiz:welcome.footer')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  backBtn: { position: 'absolute', top: 8, start: 20, zIndex: 10, paddingVertical: 8, paddingHorizontal: 4 },
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
  checklist: { fontFamily: 'DMSans_400Regular', fontSize: 11.5, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  footer: { fontFamily: 'DMSans_400Regular', fontSize: 10.5, color: C.muted, textAlign: 'center' },
});
