import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../constants';

const FEATURES = [
  { icon: '🌿', label: 'Personalized AM/PM routine' },
  { icon: '📊', label: 'Skin Era diagnosis' },
  { icon: '💌', label: 'Daily check-in reminders' },
];

export default function QuizIntroScreen({ navigation }) {
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        <Text style={s.logo}>Get Pretty</Text>

        <View style={s.heroBlock}>
          <Text style={s.heading}>Your Skin Era{'\n'}starts here</Text>
          <Text style={s.sub}>Answer a few questions and we'll build your personalized routine.</Text>
        </View>

        <View style={s.featuresBlock}>
          {FEATURES.map(f => (
            <View key={f.label} style={s.featureRow}>
              <Text style={s.featureIcon}>{f.icon}</Text>
              <Text style={s.featureLabel}>{f.label}</Text>
            </View>
          ))}
        </View>

        <View style={s.actions}>
          <Pressable
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.88 }]}
            onPress={() => navigation.navigate('QuizNew')}
          >
            <Text style={s.ctaText}>Start my skin assessment →</Text>
          </Pressable>

          <Pressable onPress={() => navigation.navigate('Login')} style={s.ghostBtn}>
            <Text style={s.ghostText}>Already have an account? Log in</Text>
          </Pressable>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.bg },
  content:      { flexGrow: 1, paddingHorizontal: 32, paddingTop: 40, paddingBottom: 40, alignItems: 'center' },

  logo:         { fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, color: C.accent, letterSpacing: 2, marginBottom: 36 },

  heroBlock:    { alignItems: 'center', marginBottom: 48 },
  heading:      { fontFamily: 'CormorantGaramond_500Medium', fontSize: 32, color: C.text, textAlign: 'center', lineHeight: 42, marginBottom: 16 },
  sub:          { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22 },

  featuresBlock:{ width: '100%', marginBottom: 52, gap: 20 },
  featureRow:   { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIcon:  { fontSize: 22, width: 32, textAlign: 'center' },
  featureLabel: { fontFamily: 'DMSans_400Regular', fontSize: 15, color: C.text },

  actions:      { width: '100%', gap: 12 },
  cta:          { backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  ctaText:      { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
  ghostBtn:     { borderWidth: 1, borderColor: C.border, borderRadius: 26, paddingVertical: 13, alignItems: 'center' },
  ghostText:    { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, letterSpacing: 0.5 },
});
