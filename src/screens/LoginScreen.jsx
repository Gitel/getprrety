import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { storeToken } from '../lib/auth';
import { logActivity } from '../lib/logActivity';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import GoogleSignInButton from '../components/GoogleSignInButton';

export default function LoginScreen({ navigation }) {
  const { analysis, setAnalysis, setUser, authReady, user } = useApp();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (authReady && user) navigation.replace(analysis ? 'Home' : 'QuizIntro');
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
      setError('Please enter your email and password.');
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
      setUser(user);
      logActivity('login');
      navigation.replace(saved ? 'Home' : 'QuizIntro');
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleToken(idToken) {
    setError(null);
    setGoogleLoading(true);
    try {
      const { token, user } = await api.post('/api/auth/google', { idToken });
      await storeToken(token);
      let saved = null;
      try {
        const response = await api.get('/api/analysis/latest');
        saved = response.analysis || null;
      } catch { /* users without an assessment continue to onboarding */ }
      setAnalysis(saved);
      setUser(user);
      logActivity('login');
      navigation.replace(saved ? 'Home' : 'QuizIntro');
    } catch (err) {
      setError(err.message || 'Google sign-in failed. Please try again.');
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

          <View style={s.headBlock}>
            <Text style={s.leaf}>🌿</Text>
            <Text style={s.logo}>Get Pretty</Text>
            <Text style={s.tagline}>SKIN INTELLIGENCE</Text>
          </View>

          <View style={s.fieldWrap}>
            <TextInput
              placeholder="Email address"
              placeholderTextColor={C.muted}
              value={email}
              onChangeText={t => { setEmail(t); setError(null); }}
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
                placeholder="Password"
                placeholderTextColor={C.muted}
                value={password}
                onChangeText={t => { setPassword(t); setError(null); }}
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
              : <Text style={s.ctaText}>LOG IN</Text>
            }
          </Pressable>

          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>or</Text>
            <View style={s.dividerLine} />
          </View>

          <GoogleSignInButton onToken={handleGoogleToken} onError={setError} loading={googleLoading} />

          <Pressable onPress={() => navigation.navigate('QuizIntro')} style={s.greenBtn}>
            <Text style={s.greenBtnText}>✦ Begin your skin assessment</Text>
          </Pressable>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: C.bg },
  content:        { flexGrow: 1, paddingHorizontal: 28, paddingTop: 44, paddingBottom: 40 },

  headBlock:      { alignItems: 'center', marginBottom: 36 },
  leaf:           { fontSize: 52, marginBottom: 16 },
  logo:           { fontFamily: 'CormorantGaramond_500Medium', fontSize: 36, color: C.text, letterSpacing: 2, marginBottom: 6 },
  tagline:        { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, letterSpacing: 3 },

  fieldWrap:      { marginBottom: 12 },
  input:          { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 13, paddingVertical: 14, paddingHorizontal: 16, fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.text },
  passwordRow:    { position: 'relative' },
  passwordInput:  { paddingRight: 48 },
  eyeBtn:         { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
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

  greenBtn:       { backgroundColor: '#3D6B35', borderRadius: 26, paddingVertical: 15, alignItems: 'center', marginBottom: 12 },
  greenBtnText:   { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF', letterSpacing: 0.4 },

  termsRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 20 },
  checkbox:       { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxChecked:{ backgroundColor: C.accent, borderColor: C.accent },
  checkmark:      { fontSize: 11, color: '#FFF', fontWeight: '700' },
  termsText:      { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, lineHeight: 17 },
  termsLink:      { fontFamily: 'DMSans_500Medium', color: C.accent },
});
