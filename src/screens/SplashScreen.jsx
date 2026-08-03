import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../constants';
import { useApp } from '../context/AppContext';

export default function SplashScreen({ navigation }) {
  const { authReady, user, analysis } = useApp();

  useEffect(() => {
    if (authReady && user) {
      navigation.replace(analysis ? 'Home' : 'QuizIntro');
    }
  }, [authReady, user, analysis]);

  if (!authReady) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.emoji}>🌿</Text>
        <Text style={s.title}>Get Pretty</Text>
        <Text style={s.sub}>SKIN INTELLIGENCE</Text>
        <Text style={s.tagline}>{'Skincare isn\'t what you apply.\nIt\'s how you live, think, and feel.'}</Text>

        <Pressable
          style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
          onPress={() => navigation.navigate('QuizIntro')}
        >
          <Text style={s.btnText}>Begin Your Skin Assessment →</Text>
        </Pressable>

        <Text style={s.hint}>11 questions · 3 minutes · built for you</Text>

        <Pressable onPress={() => navigation.navigate('Login')} style={s.loginLink}>
          <Text style={s.loginLinkText}>Already have an account? <Text style={s.loginLinkBold}>Log in</Text></Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: C.bg },
  container:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  emoji:         { fontSize: 56, marginBottom: 24 },
  title:         { fontFamily: 'CormorantGaramond_500Medium', fontSize: 30, color: C.text, letterSpacing: 2, marginBottom: 8 },
  sub:           { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, letterSpacing: 2, marginBottom: 48 },
  tagline:       { fontFamily: 'CormorantGaramond_400Regular', fontSize: 17, color: '#6B5E57', lineHeight: 30, marginBottom: 48, textAlign: 'center' },
  btn:           { width: '100%', backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  btnPressed:    { opacity: 0.85 },
  btnText:       { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
  hint:          { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, marginTop: 18, fontStyle: 'italic' },
  loginLink:     { marginTop: 32 },
  loginLinkText: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted },
  loginLinkBold: { fontFamily: 'DMSans_500Medium', color: C.accent },
});
