import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation, Trans } from 'react-i18next';
import { api } from '../lib/api';
import { errorText } from '../lib/errorText';
import { eraText } from '../lib/eraText';
import { storeToken } from '../lib/auth';
import { applyAccountLanguage } from '../lib/languageSync';
import { persistAnalysis, withSavedId } from '../lib/persistAnalysis';
import { logActivity } from '../lib/logActivity';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import GoogleSignInButton from '../components/GoogleSignInButton';
import ConsentNotice from '../components/ConsentNotice';
import { LEGAL_READY, consentParams } from '../lib/consent';
import { quizEntryScreen } from '../lib/welcomeVariants';

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// Reached two ways (login-first):
//  - from LoginScreen's "Create an account", BEFORE the quiz: no analysis in context yet;
//  - from ProfileScreen's "See My Routine" after "Skip for now", AFTER the quiz: the
//    just-finished analysis is in context and is saved here once the account exists.
// `analysis` tells the two apart and drives the copy and the next screen.
export default function SignUpScreen({ navigation }) {
  const { analysis, setAnalysis, answers, setUser, setAnalysisSaveFailed } = useApp();
  // All visible text comes from src/locales/<lang>/auth.json.
  const { t, i18n } = useTranslation();
  const era = analysis?.era;
  const afterQuiz = Boolean(analysis);

  const [firstName, setFirstName] = useState(answers?.name || '');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [errors,   setErrors]   = useState({});
  const [googleLoading, setGoogleLoading] = useState(false);

  function validate() {
    const e = {};
    if (!email.trim())             e.email = t('auth:signup.emailRequired');
    else if (!isValidEmail(email)) e.email = t('auth:signup.emailInvalid');
    if (!password)                 e.password = t('auth:signup.passwordRequired');
    else if (password.length < 8)  e.password = t('auth:signup.passwordTooShort');
    return e;
  }

  // Shared by email and Google sign-up once the account exists.
  function continueAfterSignup() {
    logActivity('signup');
    if (!afterQuiz) {
      // Login-first: nothing to save yet. Start the quiz as the new root screen so Back
      // cannot return to the auth screens. LoadingScreen saves the result (user is set).
      navigation.reset({ index: 0, routes: [{ name: quizEntryScreen() }] });
      return;
    }
    // Skip path: save the anonymous analysis to the new account, then onboarding.
    // srProducts / shelfAnalysis are on `analysis` itself, so they are saved with it.
    persistAnalysis({ analysis, answers }).then(
      saved => {
        setAnalysisSaveFailed(false);
        // Attach the saved `_id` so resume refresh can bring in clinic edits later.
        setAnalysis(current => withSavedId(current, saved));
      },
      err => {
        console.error('Failed to save analysis after retries:', err?.message || err);
        // The anonymous funnel saves here, not in LoadingScreen (user is null there),
        // so this is where most of the telemetry for a lost assessment must be recorded.
        logActivity('analysis_save_failed');
        setAnalysisSaveFailed(true);
      },
    );
    navigation.navigate('SkinTiming');
  }

  async function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    // Tapping the button under the consent notice is the acceptance; the server requires
    // this stamp to be fresh (<= 24 h), so it is taken now rather than from the quiz.
    const consent = consentParams();
    if (!consent) return; // legal links / policy version not configured — sign-up disabled
    setErrors({});
    setLoading(true);
    try {
      const { token, user: u } = await api.post('/api/auth/signup', {
        firstName: firstName.trim() || undefined,
        email,
        password,
        ...consent,
      });
      await storeToken(token);
      setUser(u);
      await applyAccountLanguage(u); // UI language = pending ?? account ?? device ?? 'en'
      continueAfterSignup();
    } catch (err) {
      // errorText turns the server's error code into a translated sentence (never raw English).
      setErrors({ submit: errorText(err, t, 'auth:signup.failed') });
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleToken(idToken) {
    setErrors({});
    setGoogleLoading(true);
    try {
      // A new Google account needs the same fresh consent stamp as email sign-up.
      const { token, user: u } = await api.post('/api/auth/google', { idToken, ...(consentParams() || {}) });
      await storeToken(token);
      setUser(u);
      await applyAccountLanguage(u); // UI language = pending ?? account ?? device ?? 'en'
      continueAfterSignup();
    } catch (err) {
      setErrors({ submit: errorText(err, t, 'auth:signup.googleFailed') });
    } finally {
      setGoogleLoading(false);
    }
  }

  // The era name in the current language (Hebrew by era id, English otherwise). Wrapped in
  // Unicode isolates (U+2068 ... U+2069) so an English name inside Hebrew text keeps its own direction.
  const eraName = '\u2068' + (eraText(era, 'name', i18n.language) || t('auth:signup.defaultEra')) + '\u2069';

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

          {/* Back */}
          {navigation.canGoBack() && (
            <Pressable onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={10}>
              <Text style={s.backText}>{t('common:back')}</Text>
            </Pressable>
          )}

          {/* Headline: the era copy after the quiz (skip path), generic copy before it */}
          {afterQuiz ? (
            <View style={s.headlineBlock}>
              <Text style={s.headline}>
                {/* <Trans> lets the translation place the coloured era name anywhere in the sentence */}
                <Trans
                  i18nKey="auth:signup.headlineAfterQuiz"
                  values={{ eraName }}
                  components={{ accent: <Text style={{ color: C.accent }} /> }}
                />
              </Text>
              <Text style={s.sub}>{t('auth:signup.subAfterQuiz')}</Text>
            </View>
          ) : (
            <View style={s.headlineBlock}>
              <Text style={s.headline}>{t('auth:signup.headline')}</Text>
              <Text style={s.sub}>{t('auth:signup.sub')}</Text>
            </View>
          )}

          <GoogleSignInButton onToken={handleGoogleToken} onError={msg => setErrors({ submit: msg })} loading={googleLoading} />

          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>{t('auth:signup.orEmail')}</Text>
            <View style={s.dividerLine} />
          </View>

          {/* First name (optional) */}
          <View style={s.fieldWrap}>
            <TextInput
              placeholder={t('auth:signup.firstNamePlaceholder')}
              placeholderTextColor={C.muted}
              value={firstName}
              onChangeText={setFirstName}
              style={s.input}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>

          {/* Email */}
          <View style={s.fieldWrap}>
            <TextInput
              placeholder={t('auth:signup.emailPlaceholder')}
              placeholderTextColor={C.muted}
              value={email}
              onChangeText={text => { setEmail(text); setErrors(v => ({ ...v, email: undefined })); }}
              style={[s.input, errors.email && s.inputError]}
              keyboardType="email-address"
              autoCapitalize="none"
              returnKeyType="next"
            />
            {errors.email && <Text style={s.error}>{errors.email}</Text>}
          </View>

          {/* Password */}
          <View style={s.fieldWrap}>
            <View style={s.passwordRow}>
              <TextInput
                placeholder={t('auth:signup.passwordPlaceholder')}
                placeholderTextColor={C.muted}
                value={password}
                onChangeText={text => { setPassword(text); setErrors(v => ({ ...v, password: undefined })); }}
                style={[s.input, s.passwordInput, errors.password && s.inputError]}
                secureTextEntry={!showPw}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <Pressable style={s.eyeBtn} onPress={() => setShowPw(v => !v)}>
                <Text style={s.eyeIcon}>{showPw ? '🙈' : '👁'}</Text>
              </Pressable>
            </View>
            {errors.password && <Text style={s.error}>{errors.password}</Text>}
          </View>

          {errors.submit && (
            <Text style={[s.error, { textAlign: 'center', marginBottom: 8 }]}>{errors.submit}</Text>
          )}

          {/* Binding Terms/Privacy notice; tapping the button below (or Google) accepts it */}
          <ConsentNotice style={s.consent} />

          <Pressable
            onPress={handleSubmit}
            disabled={loading || !LEGAL_READY}
            style={[s.cta, (loading || !LEGAL_READY) && s.ctaDisabled]}
          >
            {loading
              ? <ActivityIndicator color={C.bg} size="small" />
              : <Text style={s.ctaText}>{afterQuiz ? t('auth:signup.ctaAfterQuiz') : t('auth:signup.cta')}</Text>
            }
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#FAF7F4' },
  content:     { flexGrow: 1, padding: 24, paddingTop: 36 },

  backBtn:     { marginBottom: 20 },
  backText:    { fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#C9897A' },

  headlineBlock:{ marginBottom: 36 },
  headline:    { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: '#2C2C2C', lineHeight: 36, marginBottom: 10 },
  sub:         { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, lineHeight: 23 },

  dividerRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E8DDD8' },
  dividerText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },

  fieldWrap:   { marginBottom: 16 },
  input:       { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E8DDD8', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#2C2C2C' },
  inputError:  { borderColor: '#C9897A' },
  passwordRow: { position: 'relative' },
  // paddingEnd/end are logical: end = right in English, left in Hebrew (RTL)
  passwordInput:{ paddingEnd: 48 },
  eyeBtn:      { position: 'absolute', end: 14, top: 0, bottom: 0, justifyContent: 'center' },
  eyeIcon:     { fontSize: 16 },
  error:       { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C9897A', marginTop: 5, marginStart: 4 },

  consent:     { marginTop: 4, marginBottom: 12, paddingHorizontal: 4 },
  cta:         { backgroundColor: '#C9897A', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  ctaDisabled: { backgroundColor: '#D4C5BF' },
  ctaText:     { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FAF7F4', letterSpacing: 0.4 },
});
