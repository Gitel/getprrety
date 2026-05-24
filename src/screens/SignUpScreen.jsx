import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { C } from '../constants';
import { useApp } from '../context/AppContext';

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function SignUpScreen({ navigation }) {
  const { analysis, setUser } = useApp();
  const era = analysis?.era;

  const [firstName, setFirstName] = useState('');
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [showPw,    setShowPw]    = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [errors,    setErrors]    = useState({});

  function validate() {
    const e = {};
    if (!firstName.trim())         e.firstName = 'First name is required.';
    if (!email.trim())             e.email = 'Email is required.';
    else if (!isValidEmail(email)) e.email = 'Enter a valid email address.';
    if (!password)                 e.password = 'Password is required.';
    else if (password.length < 8)  e.password = 'Password must be at least 8 characters.';
    return e;
  }

  async function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      const userId = data.user?.id;
      if (userId) {
        await supabase.from('profiles').upsert({
          id: userId,
          first_name: firstName.trim(),
          skin_era: era?.id || null,
        });
      }
      setUser(data.user);
      navigation.navigate('SkinTiming');
    } catch (err) {
      setErrors({ submit: err.message || 'Sign up failed. Please try again.' });
    } finally {
      setLoading(false);
    }
  }

  const eraName = era?.name || 'Your Era';

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

          {/* Era headline */}
          <View style={s.headlineBlock}>
            <Text style={s.headline}>
              Your <Text style={{ color: C.accent }}>{eraName}</Text> routine is ready.
            </Text>
            <Text style={s.sub}>Create your account to unlock it — and track your skin journey.</Text>
          </View>

          {/* First Name */}
          <View style={s.fieldWrap}>
            <TextInput
              placeholder="First name"
              placeholderTextColor={C.muted}
              value={firstName}
              onChangeText={t => { setFirstName(t); setErrors(v => ({ ...v, firstName: undefined })); }}
              style={[s.input, errors.firstName && s.inputError]}
              autoCapitalize="words"
              returnKeyType="next"
            />
            {errors.firstName && <Text style={s.error}>{errors.firstName}</Text>}
          </View>

          {/* Email */}
          <View style={s.fieldWrap}>
            <TextInput
              placeholder="Email address"
              placeholderTextColor={C.muted}
              value={email}
              onChangeText={t => { setEmail(t); setErrors(v => ({ ...v, email: undefined })); }}
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
                placeholder="Password (min. 8 characters)"
                placeholderTextColor={C.muted}
                value={password}
                onChangeText={t => { setPassword(t); setErrors(v => ({ ...v, password: undefined })); }}
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

          <Pressable
            onPress={handleSubmit}
            disabled={loading}
            style={[s.cta, loading && s.ctaDisabled]}
          >
            {loading
              ? <ActivityIndicator color={C.bg} size="small" />
              : <Text style={s.ctaText}>Enter my Era →</Text>
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

  headlineBlock:{ marginBottom: 36 },
  headline:    { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: '#2C2C2C', lineHeight: 36, marginBottom: 10 },
  sub:         { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, lineHeight: 23 },

  fieldWrap:   { marginBottom: 16 },
  input:       { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E8DDD8', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#2C2C2C' },
  inputError:  { borderColor: '#C9897A' },
  passwordRow: { position: 'relative' },
  passwordInput:{ paddingRight: 48 },
  eyeBtn:      { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  eyeIcon:     { fontSize: 16 },
  error:       { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C9897A', marginTop: 5, marginLeft: 4 },

  cta:         { backgroundColor: '#C9897A', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  ctaDisabled: { backgroundColor: '#D4C5BF' },
  ctaText:     { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FAF7F4', letterSpacing: 0.4 },
});
