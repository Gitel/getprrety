import React, { useState } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../constants';
import { useApp } from '../context/AppContext';

const TOTAL_STEPS = 5;

const INTERESTS = [
  'Personalized skincare routine',
  'Skin analysis + product matching',
  'Tracking progress (before/after)',
  'Building a routine with what I already own',
  'Product ingredient checker',
  'Professional treatments guidance',
  'Seasonal routine updates',
  'Stop buying products that don\'t work',
];

const PACE_OPTIONS = [
  { value: 'chill', icon: '🧘', label: 'Chill & Steady',  desc: 'Slow, sustainable glow up. No pressure.' },
  { value: 'quick', icon: '⏱️', label: 'Pretty Quick',    desc: 'Moderate pace. Results in a few weeks.' },
  { value: 'asap',  icon: '🔥', label: 'ASAP',            desc: 'Full send. Committed to the glow era.' },
];

const EVENT_OPTIONS = [
  { value: 'trip',     icon: '✈️', label: 'Trip' },
  { value: 'wedding',  icon: '💍', label: 'Wedding' },
  { value: 'beach',    icon: '🏖️', label: 'Beach Vacation' },
  { value: 'family',   icon: '🏠', label: 'Family Gathering' },
  { value: 'party',    icon: '🎉', label: 'Party' },
  { value: 'no_event', icon: '—',  label: 'No special event' },
];

export default function QuizNewScreen({ navigation }) {
  const { setAnswers: saveAnswers } = useApp();
  const [step, setStep]       = useState(0);
  const [answers, setAnswers] = useState({});

  // Displayed step number accounts for the skippable event-date step
  const displayStep = step + 1;
  const progressPct = (displayStep / TOTAL_STEPS) * 100;

  function setAns(patch) {
    setAnswers(a => ({ ...a, ...patch }));
  }

  function toggleInterest(val) {
    setAnswers(a => {
      const cur = a.interests || [];
      return { ...a, interests: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] };
    });
  }

  function goBack() {
    if (step === 0) { navigation.goBack(); return; }
    // If on step 4 and event was 'no_event', back should go to step 2
    if (step === 4 && answers.event === 'no_event') { setStep(2); return; }
    setStep(s => s - 1);
  }

  function goNext() {
    if (step === 2 && answers.event === 'no_event') {
      setStep(4); // skip event date
      return;
    }
    if (step === 4) {
      saveAnswers(answers);
      navigation.navigate('Loading');
      return;
    }
    setStep(s => s + 1);
  }

  const canNext = (() => {
    if (step === 0) return (answers.interests || []).length > 0;
    if (step === 1) return !!answers.pace;
    if (step === 2) return !!answers.event;
    if (step === 3) return !!answers.eventDate;
    return true; // step 4 always enabled
  })();

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={goBack} style={s.backBtn}>
            <Text style={s.backText}>←</Text>
          </Pressable>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${progressPct}%` }]} />
          </View>
          <Text style={s.counter}>{displayStep}/{TOTAL_STEPS}</Text>
        </View>

        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* ── STEP 0: Interests ── */}
          {step === 0 && (
            <>
              <View style={s.sectionBar}>
                <Text style={s.sectionLabel}>About You</Text>
              </View>
              <Text style={s.question}>What are you interested in?</Text>
              <Text style={s.hint}>Pick everything that speaks to you ✨</Text>

              <View style={s.chipRow}>
                {INTERESTS.map(v => {
                  const active = (answers.interests || []).includes(v);
                  return (
                    <Pressable
                      key={v}
                      onPress={() => toggleInterest(v)}
                      style={[s.chip, active && s.chipActive]}
                    >
                      <Text style={[s.chipText, active && s.chipTextActive]}>{v}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={s.inputGroup}>
                <Text style={s.fieldLabel}>YOUR BIRTHDAY</Text>
                <TextInput
                  style={s.input}
                  placeholder="DD / MM / YYYY"
                  placeholderTextColor={C.muted}
                  value={answers.birthday || ''}
                  onChangeText={t => setAns({ birthday: t })}
                  keyboardType="numbers-and-punctuation"
                  returnKeyType="next"
                />
              </View>

              <View style={s.inputGroup}>
                <Text style={s.fieldLabel}>YOUR NAME</Text>
                <TextInput
                  style={s.input}
                  placeholder="What do your besties call you?"
                  placeholderTextColor={C.muted}
                  value={answers.name || ''}
                  onChangeText={t => setAns({ name: t })}
                  autoCapitalize="words"
                  returnKeyType="done"
                />
              </View>

              <Btn onPress={goNext} disabled={!canNext} label="Next →" />
            </>
          )}

          {/* ── STEP 1: Pace ── */}
          {step === 1 && (
            <>
              <View style={s.sectionBar}>
                <Text style={s.sectionLabel}>Almost There</Text>
              </View>
              <Text style={s.question}>How fast do you want results?</Text>
              <Text style={s.hint}>We'll adjust your skin plan to match your vibe</Text>

              {PACE_OPTIONS.map(o => {
                const selected = answers.pace === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => setAns({ pace: o.value })}
                    style={[s.optionCard, selected && s.optionCardSelected]}
                  >
                    <View style={s.optionCardInner}>
                      <View style={s.optionIconCircle}>
                        <Text style={{ fontSize: 16 }}>{o.icon}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.optionLabel, selected && s.optionLabelSelected]}>{o.label}</Text>
                        <Text style={s.optionDesc}>{o.desc}</Text>
                      </View>
                    </View>
                    {selected && <Text style={s.check}>✓</Text>}
                  </Pressable>
                );
              })}

              <Btn onPress={goNext} disabled={!canNext} label="Next →" />
            </>
          )}

          {/* ── STEP 2: Event ── */}
          {step === 2 && (
            <>
              <View style={s.sectionBar}>
                <Text style={s.sectionLabel}>Almost There</Text>
              </View>
              <Text style={s.question}>Do you want to be ready for an event?</Text>
              <Text style={s.hint}>A visible deadline helps you glow up faster 💅</Text>

              {EVENT_OPTIONS.map(o => {
                const selected = answers.event === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => setAns({ event: o.value })}
                    style={[s.optionCard, selected && s.optionCardSelected]}
                  >
                    <View style={s.optionCardInner}>
                      <View style={s.optionIconCircle}>
                        <Text style={{ fontSize: 16 }}>{o.icon}</Text>
                      </View>
                      <Text style={[s.optionLabel, selected && s.optionLabelSelected]}>{o.label}</Text>
                    </View>
                    {selected && <Text style={s.check}>✓</Text>}
                  </Pressable>
                );
              })}

              <Btn onPress={goNext} disabled={!canNext} label="Next →" />
            </>
          )}

          {/* ── STEP 3: Event Date (conditional) ── */}
          {step === 3 && (
            <>
              <View style={s.sectionBar}>
                <Text style={s.sectionLabel}>Almost There</Text>
              </View>
              <Text style={s.question}>When's your event?</Text>
              <Text style={s.hint}>We'll build your skin plan to peak right on time ✨</Text>

              <View style={s.dateBlock}>
                <TextInput
                  style={s.dateInput}
                  placeholder="DD / MM / YYYY"
                  placeholderTextColor={C.muted}
                  value={answers.eventDate || ''}
                  onChangeText={t => setAns({ eventDate: t })}
                  keyboardType="numbers-and-punctuation"
                  returnKeyType="done"
                />
              </View>

              <Btn onPress={goNext} disabled={!canNext} label="Next →" />

              <Pressable onPress={() => { setAns({ eventDate: null }); goNext(); }} style={s.ghostBtn}>
                <Text style={s.ghostText}>Skip this question</Text>
              </Pressable>
            </>
          )}

          {/* ── STEP 4: Completion ── */}
          {step === 4 && (
            <View style={s.completionBlock}>
              <View style={s.sectionBar}>
                <Text style={s.sectionLabel}>You're all set ✨</Text>
              </View>
              <Text style={s.completionEmoji}>🌿</Text>
              <Text style={s.completionHeading}>Your Skin Era is ready</Text>
              <Text style={s.completionSub}>
                We're analyzing your answers to build your personalized routine.
              </Text>
              <Btn onPress={goNext} label="See my Skin Era →" accent />
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Btn({ onPress, disabled, label, accent }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        accent && { backgroundColor: C.accent },
        disabled && s.btnDisabled,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.bg },
  content: { padding: 24, paddingTop: 8 },

  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  backBtn:       { width: 32 },
  backText:      { fontFamily: 'DMSans_400Regular', fontSize: 20, color: C.accent },
  progressTrack: { flex: 1, height: 2, backgroundColor: C.border, borderRadius: 1 },
  progressFill:  { height: 2, backgroundColor: C.accent, borderRadius: 1 },
  counter:       { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, width: 28, textAlign: 'right' },

  sectionBar:   { paddingBottom: 16 },
  sectionLabel: { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2.5, textTransform: 'uppercase' },
  question:     { fontFamily: 'CormorantGaramond_500Medium', fontSize: 22, color: C.text, lineHeight: 32, marginBottom: 4 },
  hint:         { fontFamily: 'DMSans_400Regular', fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 20, lineHeight: 19 },

  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 28 },
  chip:         { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 22, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  chipActive:   { backgroundColor: C.accent, borderColor: C.accent },
  chipText:     { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#4A4039' },
  chipTextActive:{ fontFamily: 'DMSans_500Medium', color: '#FFF' },

  inputGroup:   { marginBottom: 16 },
  fieldLabel:   { fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  input:        { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.text },

  optionCard:         { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 13, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  optionCardSelected: { backgroundColor: C.accentLight, borderColor: C.accent },
  optionCardInner:    { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  optionIconCircle:   { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0E8E0', alignItems: 'center', justifyContent: 'center' },
  optionLabel:        { fontFamily: 'DMSans_400Regular', fontSize: 15, color: '#4A4039' },
  optionLabelSelected:{ fontFamily: 'DMSans_500Medium', color: C.accent },
  optionDesc:         { fontFamily: 'DMSans_400Regular', fontSize: 11, color: C.muted, marginTop: 1 },
  check:              { color: C.accent, fontWeight: '700', fontSize: 16 },

  dateBlock:  { alignItems: 'center', marginBottom: 24 },
  dateInput:  { fontFamily: 'CormorantGaramond_500Medium', fontSize: 30, color: C.text, textAlign: 'center', borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 8, paddingHorizontal: 16, minWidth: 220 },

  completionBlock:   { paddingTop: 32, alignItems: 'center' },
  completionEmoji:   { fontSize: 48, marginBottom: 20 },
  completionHeading: { fontFamily: 'CormorantGaramond_500Medium', fontSize: 28, color: C.text, textAlign: 'center', marginBottom: 16 },
  completionSub:     { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 36, paddingHorizontal: 8 },

  btn:        { width: '100%', backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginBottom: 16, marginTop: 8 },
  btnDisabled:{ backgroundColor: '#D4CBC4' },
  btnText:    { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 0.4 },
  ghostBtn:   { borderWidth: 1, borderColor: C.border, borderRadius: 26, paddingVertical: 13, alignItems: 'center', marginBottom: 8 },
  ghostText:  { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, letterSpacing: 1 },
});
