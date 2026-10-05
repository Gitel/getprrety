import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation, Trans } from 'react-i18next';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import ConsentNotice from '../components/ConsentNotice';
import { LEGAL_READY, consentParams } from '../lib/consent';

// Landing screen for signed-out users (quiz-first). Signed-out users see the Terms/Privacy
// notice and tapping start stamps the consent (see lib/consent.js); they also get a
// "Log in" control for existing accounts. Signed-in users (retake) see neither: no
// notice, no log-in control, and the start button is always enabled.
export default function QuizIntroScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { user } = useApp();
  const signedOut = !user;
  // The intro copy lives in quiz.json under the "welcome" question id (quiz:welcome.*). The checklist is a list, so its key uses backticks: the static-key test only checks plain-string keys.
  const checklist = t(`quiz:welcome.checklist`, { returnObjects: true });
  // Signed-out start is blocked until the legal links / policy version are configured.
  const startDisabled = signedOut && !LEGAL_READY;
  function begin() {
    const referralSource = route?.params?.referralSource || null;
    if (!signedOut) {
      // Signed-in retake: no consent is collected here.
      navigation.navigate('Quiz', { consentAcceptedAt: null, consentVersion: null, referralSource });
      return;
    }
    const consent = consentParams();
    if (!consent) return; // legal links / policy version not configured - onboarding disabled
    navigation.navigate('Quiz', { ...consent, referralSource });
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
          {signedOut && <ConsentNotice style={s.consent} />}
          <Pressable
            disabled={startDisabled}
            style={({ pressed }) => [s.cta, startDisabled && s.ctaDisabled, pressed && !startDisabled && { opacity: 0.88 }]}
            onPress={begin}
          >
            <Text style={s.ctaText}>{t('quiz:welcome.cta')}</Text>
          </Pressable>
          {signedOut && (
            <Pressable onPress={() => navigation.navigate('Login')} style={s.ghostBtn}>
              <Text style={s.ghostText}>
                <Trans i18nKey="auth:login.haveAccount" components={{ accent: <Text /> }} />
              </Text>
            </Pressable>
          )}
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
  consent: { marginBottom: 4 },
  cta: { backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  ctaDisabled: { backgroundColor: '#D4CBC4' },
  ctaText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
  ghostBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 26, paddingVertical: 13, alignItems: 'center' },
  ghostText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, letterSpacing: 0.5 },
  checklist: { fontFamily: 'DMSans_400Regular', fontSize: 11.5, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  footer: { fontFamily: 'DMSans_400Regular', fontSize: 10.5, color: C.muted, textAlign: 'center' },
});
