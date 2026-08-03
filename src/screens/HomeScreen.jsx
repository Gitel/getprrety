import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, Modal, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, MOODS, DONE_MSGS } from '../constants';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { logActivity } from '../lib/logActivity';

export default function HomeScreen({ navigation }) {
  const { analysis } = useApp();
  const era     = analysis?.era;
  const routine = analysis?.routine || { am: [], pm: [] };

  const [tab,       setTab]      = useState('am');
  const [done,      setDone]     = useState({});
  const [ciOpen,    setCiOpen]   = useState(false);
  const [checkedIn, setCheckedIn]= useState(null);
  const [mood,      setMood]     = useState(null);

  const steps     = tab === 'am' ? routine.am : routine.pm;
  const doneCount = steps.filter((_, i) => done[tab + i]).length;
  const allDone   = doneCount === steps.length && steps.length > 0;
  const toggle    = i => setDone(p => ({ ...p, [tab + i]: !p[tab + i] }));
  const hour      = new Date().getHours();
  const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (!analysis) {
    return (
      <SafeAreaView style={[s.safe, { backgroundColor: C.bg }]}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
          <Text style={{ fontSize: 42, marginBottom: 16 }}>🌿</Text>
          <Text style={[s.doneTitleText, { color: C.text, marginBottom: 10 }]}>Your routine is not ready yet</Text>
          <Text style={[s.doneMsg, { marginBottom: 22 }]}>Complete the skin assessment to build your personalized routine.</Text>
          <Pressable style={[s.productCta, { borderColor: C.accent }]} onPress={() => navigation.navigate('QuizIntro')}>
            <Text style={s.productCtaTitle}>Start assessment →</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: era.bg }]}>
      <ScrollView contentContainerStyle={s.content}>

        {/* Greeting row */}
        <View style={s.greetingRow}>
          <View>
            <Text style={s.greetingText}>{greeting}</Text>
            <Text style={[s.eraTag, { color: era.color }]}>{era.emoji} {era.name}</Text>
          </View>
          <Pressable onPress={() => navigation.navigate('Settings')}>
            <Text style={{ fontSize: 20 }}>⚙️</Text>
          </Pressable>
        </View>

        {/* Check-in card */}
        {!checkedIn ? (
          <Pressable
            style={[s.checkInCard, { borderColor: era.color + '40' }]}
            onPress={() => setCiOpen(true)}
          >
            <Text style={{ fontSize: 22 }}>🪞</Text>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={s.checkInTitle}>Daily skin check-in</Text>
              <Text style={s.checkInSub}>How does your skin feel today?</Text>
            </View>
            <Text style={[s.checkInArrow, { color: era.color }]}>→</Text>
          </Pressable>
        ) : (
          <View style={[s.checkInDone, { borderColor: era.color + '40' }]}>
            <Text style={s.checkInDoneText}>
              {MOODS.find(m => m.label === checkedIn)?.emoji} Check-in complete · {checkedIn}
            </Text>
          </View>
        )}

        {/* Progress */}
        <View style={s.progressRow}>
          <Text style={s.progressLabel}>{doneCount}/{steps.length} steps complete</Text>
          {allDone && <Text style={[s.progressDone, { color: era.color }]}>✓ Ritual complete</Text>}
        </View>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: steps.length ? `${(doneCount / steps.length) * 100}%` : '0%', backgroundColor: era.color }]} />
        </View>
        <Text style={s.progressHint}>Check off each step once you've completed it</Text>

        {/* AM / PM tabs */}
        <View style={s.tabs}>
          {[{ key:'am', label:'☀️ Morning' }, { key:'pm', label:'🌙 Evening' }].map(t => (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[s.tabBtn, tab === t.key && { borderBottomColor: era.color }]}
            >
              <Text style={[s.tabText, tab === t.key && { color: era.color, fontFamily: 'DMSans_500Medium' }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Steps */}
        <View style={s.stepList}>
          {steps.map((step, i) => (
            <Pressable
              key={i}
              onPress={() => toggle(i)}
              style={[s.stepCard, done[tab + i] && { opacity: 0.5 }]}
            >
              <View style={[s.stepNum, done[tab + i] && { backgroundColor: era.color }]}>
                <Text style={[s.stepNumText, done[tab + i] && { color: '#FFF' }]}>
                  {done[tab + i] ? '✓' : i + 1}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.stepName, done[tab + i] && { textDecorationLine: 'line-through' }]}>{step.name}</Text>
                <Text style={s.stepDesc}>{step.description}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Completion card */}
        {allDone && (
          <View style={[s.doneCard, { backgroundColor: era.color + '15', borderColor: era.color + '40' }]}>
            <Text style={{ fontSize: 32, marginBottom: 10 }}>🎉</Text>
            <Text style={[s.doneTitleText, { color: era.color }]}>Well done!</Text>
            <Text style={s.doneMsg}>{DONE_MSGS[era.id]}</Text>
          </View>
        )}

        {/* Affirmation */}
        <View style={[s.affirmCard, { borderColor: era.color + '25' }]}>
          <Text style={[s.affirmText, { color: '#6B5E57' }]}>"{analysis.affirmation || era.affirmation}"</Text>
        </View>

        {/* Product camera CTA */}
        <Pressable
          style={[s.productCta, { borderColor: era.color + '40' }]}
          onPress={() => navigation.navigate('ProductCamera')}
        >
          <Text style={{ fontSize: 20 }}>📦</Text>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.productCtaTitle}>Log your products</Text>
            <Text style={s.productCtaSub}>Save a product photo to track what you're using</Text>
          </View>
          <Text style={[s.checkInArrow, { color: era.color }]}>→</Text>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Check-in modal */}
      <Modal visible={ciOpen} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Skin check-in</Text>
              <Pressable onPress={() => setCiOpen(false)}>
                <Text style={{ fontSize: 18, color: C.muted }}>✕</Text>
              </Pressable>
            </View>
            <Text style={s.modalQuestion}>How does your skin feel right now?</Text>
            <View style={s.moodRow}>
              {MOODS.map(m => (
                <Pressable
                  key={m.label}
                  onPress={() => setMood(m.label)}
                  style={[s.moodBtn, mood === m.label && { borderColor: era.color, backgroundColor: era.bg }]}
                >
                  <Text style={{ fontSize: 20 }}>{m.emoji}</Text>
                  <Text style={[s.moodLabel, mood === m.label && { color: era.color }]}>{m.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => {
                if (!mood) return;
                api.post('/api/checkins', { mood }).catch(() => {});
                logActivity('checkin');
                setCheckedIn(mood);
                setCiOpen(false);
                setMood(null);
              }}
              disabled={!mood}
              style={[s.moodCta, { backgroundColor: mood ? era.color : '#D4CBC4' }]}
            >
              <Text style={s.moodCtaText}>Save check-in</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1 },
  content:     { padding: 22, paddingTop: 22 },
  greetingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  greetingText:{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, marginBottom: 4 },
  eraTag:      { fontFamily: 'CormorantGaramond_500Medium', fontSize: 17 },
  checkInCard: { backgroundColor: C.card, borderWidth: 1.5, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 22 },
  checkInTitle:{ fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text, marginBottom: 2 },
  checkInSub:  { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  checkInArrow:{ fontSize: 16 },
  checkInDone: { borderWidth: 1.5, borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 22 },
  checkInDoneText:{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  progressLabel:{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  progressDone: { fontFamily: 'DMSans_500Medium', fontSize: 12 },
  progressTrack:{ height: 3, backgroundColor: C.border, borderRadius: 2, marginBottom: 10 },
  progressFill: { height: 3, borderRadius: 2 },
  progressHint: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 18, textAlign: 'center' },
  tabs:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 20 },
  tabBtn:      { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabText:     { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted },
  stepList:    { gap: 10, marginBottom: 24 },
  stepCard:    { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 13, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 13 },
  stepNum:     { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F0EBE5', alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: C.muted },
  stepName:    { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text, marginBottom: 2 },
  stepDesc:    { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, lineHeight: 18 },
  doneCard:    { borderWidth: 1.5, borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center' },
  doneTitleText:{ fontFamily: 'CormorantGaramond_500Medium', fontSize: 17, marginBottom: 8 },
  doneMsg:     { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#6B5E57', lineHeight: 22, textAlign: 'center' },
  affirmCard:  { borderWidth: 1, borderRadius: 13, padding: 18, marginBottom: 16, alignItems: 'center' },
  affirmText:  { fontFamily: 'CormorantGaramond_400Regular', fontSize: 14, lineHeight: 23, fontStyle: 'italic', textAlign: 'center' },
  productCta:  { backgroundColor: C.card, borderWidth: 1.5, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center' },
  productCtaTitle:{ fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text, marginBottom: 2 },
  productCtaSub:{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted },
  modalOverlay:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  modalSheet:  { backgroundColor: C.bg, borderRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle:  { fontFamily: 'CormorantGaramond_500Medium', fontSize: 19, color: C.text },
  modalQuestion:{ fontFamily: 'CormorantGaramond_500Medium', fontSize: 17, color: C.text, marginBottom: 18 },
  moodRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
  moodBtn:     { borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, borderRadius: 12, padding: 10, paddingHorizontal: 13, alignItems: 'center', gap: 4 },
  moodLabel:   { fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#6B5E57' },
  moodCta:     { borderRadius: 13, paddingVertical: 14, alignItems: 'center' },
  moodCtaText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#FFF' },
});
