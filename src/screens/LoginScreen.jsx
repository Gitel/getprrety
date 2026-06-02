import React, { useState } from 'react';
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

export default function LoginScreen({ navigation }) {
  const { setUser } = useApp();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

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
      setUser(user);
      logActivity('login');
      navigation.replace('Home');
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

          <Pressable onPress={() => navigation.goBack()} style={s.back}>
            <Text style={s.backText}>← Back</Text>
          </Pressable>

          <View style={s.headlineBlock}>
            <Text style={s.headline}>Welcome back.</Text>
            <Text style={s.sub}>Log in to continue your skin journey.</Text>
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

          {error && (
            <Text style={s.errorText}>{error}</Text>
          )}

          <Pressable
            onPress={handleLogin}
            disabled={loading}
            style={[s.cta, loading && s.ctaDisabled]}
          >
            {loading
              ? <ActivityIndicator color={C.bg} size="small" />
              : <Text style={s.ctaText}>Log in →</Text>
            }
          </Pressable>

          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>or</Text>
            <View style={s.dividerLine} />
          </View>

          <Pressable onPress={() => navigation.navigate('QuizIntro')} style={s.assessBtn}>
            <Text style={s.assessBtnText}>✦ Begin your skin assessment</Text>
          </Pressable>

          <Pressable onPress={() => navigation.navigate('Quiz')} style={s.createBtn}>
            <Text style={s.createBtnText}>Create Account</Text>
          </Pressable>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: '#FAF7F4' },
  content:        { flexGrow: 1, padding: 24, paddingTop: 24 },
  back:           { marginBottom: 28 },
  backText:       { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.accent },
  headlineBlock:  { marginBottom: 36 },
  headline:       { fontFamily: 'CormorantGaramond_500Medium', fontSize: 28, color: '#2C2C2C', lineHeight: 38, marginBottom: 8 },
  sub:            { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, lineHeight: 23 },
  fieldWrap:      { marginBottom: 16 },
  input:          { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E8DDD8', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#2C2C2C' },
  passwordRow:    { position: 'relative' },
  passwordInput:  { paddingRight: 48 },
  eyeBtn:         { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  eyeIcon:        { fontSize: 16 },
  errorText:      { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C9897A', marginBottom: 12, textAlign: 'center' },
  cta:            { backgroundColor: '#C9897A', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  ctaDisabled:    { backgroundColor: '#D4C5BF' },
  ctaText:        { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FAF7F4', letterSpacing: 0.4 },
  dividerRow:    { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 12 },
  dividerLine:   { flex: 1, height: 1, backgroundColor: C.border },
  dividerText:   { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  assessBtn:     { backgroundColor: C.accent, borderRadius: 26, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  assessBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FAF7F4', letterSpacing: 0.3 },
  createBtn:     { borderWidth: 1, borderColor: C.border, borderRadius: 26, paddingVertical: 13, alignItems: 'center' },
  createBtnText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, letterSpacing: 1 },
});
