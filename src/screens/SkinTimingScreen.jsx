import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { C } from '../constants';
import { useApp } from '../context/AppContext';

const OPTIONS = [
  { value: 'morning', emoji: '🌅', label: 'Morning person' },
  { value: 'night',   emoji: '🌙', label: 'Night owl' },
  { value: 'both',    emoji: '✨', label: 'Both' },
];

export default function SkinTimingScreen({ navigation }) {
  const { user } = useApp();
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  async function handleContinue() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      await api.patch('/api/profile', { skincareTiming: selected });
      navigation.navigate('SkinSelfie');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>

        {navigation.canGoBack() && (
          <Pressable onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={10}>
            <Text style={s.backText}>← Back</Text>
          </Pressable>
        )}

        <View style={s.headlineBlock}>
          <Text style={s.headline}>One last thing —</Text>
          <Text style={s.sub}>when do you usually do your skincare?</Text>
        </View>

        <View style={s.cards}>
          {OPTIONS.map(opt => (
            <TimingCard
              key={opt.value}
              emoji={opt.emoji}
              label={opt.label}
              selected={selected === opt.value}
              onSelect={() => setSelected(opt.value)}
            />
          ))}
        </View>

        {error && <Text style={s.error}>{error}</Text>}

        <Pressable
          onPress={handleContinue}
          disabled={!selected || loading}
          style={[s.cta, (!selected || loading) && s.ctaDisabled]}
        >
          {loading
            ? <ActivityIndicator color={C.bg} size="small" />
            : <Text style={s.ctaText}>Let's go →</Text>
          }
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function TimingCard({ emoji, label, selected, onSelect }) {
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        s.card,
        selected && s.cardSelected,
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <Text style={s.cardEmoji}>{emoji}</Text>
      <Text style={[s.cardLabel, selected && s.cardLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#FAF7F4' },
  container:   { flex: 1, padding: 24, paddingTop: 40 },
  backBtn:     { marginBottom: 20 },
  backText:    { fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#C9897A' },
  headlineBlock:{ marginBottom: 36 },
  headline:    { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: '#2C2C2C', lineHeight: 36, marginBottom: 6 },
  sub:         { fontFamily: 'DMSans_400Regular', fontSize: 15, color: C.muted, lineHeight: 24 },
  cards:       { flex: 1, gap: 12 },
  card:        { width: '100%', paddingVertical: 20, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1.5, borderColor: '#E8DDD8', backgroundColor: '#FFFFFF', alignItems: 'center', gap: 8 },
  cardSelected:{ borderColor: '#C9897A', backgroundColor: '#C9897A' },
  cardEmoji:   { fontSize: 28, lineHeight: 34 },
  cardLabel:   { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#2C2C2C' },
  cardLabelSelected:{ color: '#FAF7F4' },
  error:       { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C9897A', textAlign: 'center', marginBottom: 8 },
  cta:         { backgroundColor: '#C9897A', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
  ctaDisabled: { backgroundColor: '#D4C5BF' },
  ctaText:     { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FAF7F4', letterSpacing: 0.4 },
});
