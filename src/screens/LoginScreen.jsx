import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorText } from '../lib/errorText';
import { storeToken } from '../lib/auth';
import { applyAccountLanguage } from '../lib/languageSync';
import { logActivity } from '../lib/logActivity';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import GoogleSignInButton from '../components/GoogleSignInButton';
import ConsentNotice from '../components/ConsentNotice';
import { consentParams } from '../lib/consent';
import { quizEntryScreen } from '../lib/welcomeVariants';

// Pure log-in screen (email or Google). It is opened from the signed-out landing's
// "Already have an account? Log in" control, and after log out. Back returns to the
// landing. Accounts are NOT created here: sign-up only happens after the quiz
// (ProfileScreen "See My Routine" -> SignUpScreen).
export default function LoginScreen({ navigation }) {
  const { analysis, setAnalysis, setUser, authReady, user } = useApp();
  // All visible text comes from src/locales/<lang>/auth.json.
  // (Called before the early return below: hooks must run in the same order every render.)
  const { t } = useTranslation();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    // reset (not replace): Login sits on top of the signed-out landing, and replace would
    // leave that landing under Home, so Back / edge swipe from Home would show a signed-in
    // user the signed-out landing. Reset makes the target the only screen.
    if (authReady && user) navigation.reset({ index: 0, routes: [{ name: analysis ? 'Home' : quizEntryScreen() }] });
  }, [authReady, user, analysis]);

  // Show a spinner while auth resolves AND while a logged-in user is being redirected,
  // so the login form never flashes for an already-authenticated user on refresh.
  if (!authReady || user) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError(t('auth:login.missingFields'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await api.post('/api/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });
      await storeToken(token);
      let saved = null;
      try {
        const response = await api.get('/api/analysis/latest');
        saved = response.analysis || null;
      } catch { /* users without an assessment continue to onboarding */ }
      setAnalysis(saved);
      await applyAccountLanguage(user); // UI language = pending ?? account ?? device ?? 'en'
      setUser(user);
      logActivity('login');
      // reset (not replace): see the useEffect above, the landing must not stay under Home.
      navigation.reset({ index: 0, routes: [{ name: saved ? 'Home' : quizEntryScreen() }] });
    } catch (err) {
      // errorText maps the server's error code to a translated sentence, so a Hebrew
      // user never sees the server's English message.
      setError(errorText(err, t, 'auth:login.failed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleToken(idToken) {
    setError(null);
    setGoogleLoading(true);
    try {
      // Google creates the account if none exists, and the server then requires a fresh
      // consent stamp (the notice on this screen). Existing users ignore it server-side.
      const { token, user } = await api.post('/api/auth/google', { idToken, ...(consentParams() || {}) });
      await storeToken(token);
      let saved = null;
      try {
        const response = await api.get('/api/analysis/latest');
        saved = response.analysis || null;
      } catch { /* users without an assessment continue to onboarding */ }
      setAnalysis(saved);
      await applyAccountLanguage(user); // UI language = pending ?? account ?? device ?? 'en'
      setUser(user);
      logActivity('login');
      // reset (not replace): see the useEffect above, the landing must not stay under Home.
      navigation.reset({ index: 0, routes: [{ name: saved ? 'Home' : quizEntryScreen() }] });
    } catch (err) {
      setError(errorText(err, t, 'auth:login.googleFailed'));
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Back to the signed-out landing this screen was opened from */}
          {navigation.canGoBack() && (
            <Pressable onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={10}>
              <Text style={s.backText}>{t('common:back')}</Text>
            </Pressable>
          )}

          <View style={s.headBlock}>
            <Text style={s.leaf}>🌿</Text>
            <Text style={s.logo}>Get Pretty</Text>
            <Text style={s.tagline}>{t('auth:login.tagline')}</Text>
          </View>

          <View style={s.fieldWrap}>
            <TextInput
              placeholder={t('auth:login.emailPlaceholder')}
              placeholderTextColor={C.muted}
              value={email}
              onChangeText={v => { setEmail(v); setError(null); }}
              style={s.input}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
          </View>

          <View style={s.fieldWrap}>
            <View style={s.passwordRow}>
              <TextInput
                placeholder={t('auth:login.passwordPlaceholder')}
                placeholderTextColor={C.muted}
                value={password}
                onChangeText={v => { setPassword(v); setError(null); }}
                style={[s.input, s.passwordInput]}
                secureTextEntry={!showPw}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <Pressable style={s.eyeBtn} onPress={() => setShowPw(v => !v)}>
                <Text style={s.eyeIcon}>{showPw ? '🙈' : '👁'}</Text>
              </Pressable>
            </View>
          </View>

          {error && <Text style={s.errorText}>{error}</Text>}

          <Pressable
            onPress={handleLogin}
            disabled={loading}
            style={[s.cta, loading && s.ctaDisabled]}
          >
            {loading
              ? <ActivityIndicator color={C.bg} size="small" />
              : <Text style={s.ctaText}>{t('auth:login.cta')}</Text>
            }
          </Pressable>

          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>{t('auth:login.or')}</Text>
            <View style={s.dividerLine} />
          </View>

          <GoogleSignInButton onToken={handleGoogleToken} onError={setError} loading={googleLoading} />

          {/* Binding Terms/Privacy notice: Google sign-in can still create a new account
              here, and the server then requires a fresh consent stamp. Email accounts are
              created only on SignUpScreen (after the quiz), which shows its own copy. */}
          <ConsentNotice style={s.consent} />

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: C.bg },
  content:        { flexGrow: 1, paddingHorizontal: 28, paddingTop: 44, paddingBottom: 40 },

  backBtn:        { marginBottom: 20 },
  backText:       { fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#C9897A' },

  headBlock:      { alignItems: 'center', marginBottom: 36 },
  leaf:           { fontSize: 52, marginBottom: 16 },
  logo:           { fontFamily: 'CormorantGaramond_500Medium', fontSize: 36, color: C.text, letterSpacing: 2, marginBottom: 6 },
  tagline:        { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, letterSpacing: 3 },

  fieldWrap:      { marginBottom: 12 },
  input:          { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 13, paddingVertical: 14, paddingHorizontal: 16, fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.text },
  passwordRow:    { position: 'relative' },
  // paddingEnd/end are logical: end = right in English, left in Hebrew (RTL)
  passwordInput:  { paddingEnd: 48 },
  eyeBtn:         { position: 'absolute', end: 14, top: 0, bottom: 0, justifyContent: 'center' },
  eyeIcon:        { fontSize: 16 },

  forgotRow:      { alignItems: 'center', marginBottom: 20 },
  forgotText:     { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },

  errorText:      { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C9897A', marginBottom: 12, textAlign: 'center' },

  cta:            { backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 20 },
  ctaDisabled:    { backgroundColor: '#D4CBC4' },
  ctaText:        { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 1.5 },

  dividerRow:     { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  dividerLine:    { flex: 1, height: 1, backgroundColor: C.border },
  dividerText:    { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },

  consent:        { marginTop: 8, marginBottom: 16, paddingHorizontal: 4 },

  termsRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 20 },
  checkbox:       { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxChecked:{ backgroundColor: C.accent, borderColor: C.accent },
  checkmark:      { fontSize: 11, color: '#FFF', fontWeight: '700' },
  termsText:      { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, lineHeight: 17 },
  termsLink:      { fontFamily: 'DMSans_500Medium', color: C.accent },
});
