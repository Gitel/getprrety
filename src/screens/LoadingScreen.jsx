import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, analyzeWithAI, buildFallback } from '../constants';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';

const STEPS = [
  { label: 'Reading your skin signals...',          icon: '🔍' },
  { label: 'Analysing your uploaded photos...',     icon: '📸' },
  { label: 'Auditing your current products...',     icon: '🧴' },
  { label: 'Building your personalized routine...', icon: '✨' },
  { label: 'Finalizing your Skin Era profile...',   icon: '🌿' },
];

export default function LoadingScreen({ navigation }) {
  const { answers, setAnalysis } = useApp();
  const [step, setStep]         = useState(0);
  const [complete, setComplete] = useState(false);
  const called                  = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;
    STEPS.forEach((_, i) => setTimeout(() => setStep(i), i * 900));
    const minWait = STEPS.length * 900 + 500;

    analyzeWithAI(answers || {})
      .then(result => saveAndNavigate(result))
      .catch(err => {
        console.warn('AI fallback:', err.message);
        saveAndNavigate(buildFallback(answers || {}));
      });

    function saveAndNavigate(result) {
      api.post('/api/analysis', {
        eraId:       result.era?.id,
        era:         result.era,
        skinAnalysis:result.skinAnalysis,
        keyInsights: result.keyInsights,
        productAudit:result.productAudit,
        routine:     result.routine,
        affirmation: result.affirmation,
        quizAnswers: answers,
      }).catch(() => {});
      setTimeout(() => {
        setComplete(true);
        setTimeout(() => {
          setAnalysis(result);
          navigation.navigate('Profile');
        }, 700);
      }, minWait);
    }
  }, []);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.emoji}>🌿</Text>
        <Text style={s.title}>Analysing your skin story</Text>
        <Text style={s.subtitle}>Our cosmetology engine is reading every signal you shared</Text>

        <View style={s.steps}>
          {STEPS.map((st, i) => {
            const isActive = i === step && !complete;
            const isDone   = i < step || complete;
            return (
              <View key={i} style={[s.step, (isDone || isActive) && s.stepVisible]}>
                <View style={[s.dot, isDone && s.dotDone, isActive && s.dotActive]}>
                  <Text style={s.dotText}>{isDone ? '✓' : isActive ? st.icon : ''}</Text>
                </View>
                <Text style={[s.stepLabel, (isDone || isActive) && { color: C.text }]}>{st.label}</Text>
                {isActive && <Text style={s.inProgress}>in progress</Text>}
              </View>
            );
          })}
        </View>

        {complete && (
          <View style={s.doneBadge}>
            <Text style={s.doneText}>✓ Analysis complete — revealing your Skin Era</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#FAF3EF' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  emoji:     { fontSize: 52, marginBottom: 18 },
  title:     { fontFamily: 'CormorantGaramond_500Medium', fontSize: 21, color: C.text, marginBottom: 8 },
  subtitle:  { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, marginBottom: 30, lineHeight: 21, fontStyle: 'italic', textAlign: 'center' },
  steps:     { width: '100%', gap: 9, marginBottom: 28 },
  step:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11, paddingHorizontal: 16, borderRadius: 12, backgroundColor: 'transparent' },
  stepVisible:{ backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  dot:       { width: 26, height: 26, borderRadius: 13, backgroundColor: '#E8E0D8', alignItems: 'center', justifyContent: 'center' },
  dotDone:   { backgroundColor: '#7A9E6E' },
  dotActive: { backgroundColor: C.accent },
  dotText:   { fontSize: 11, color: '#FFF', fontWeight: '700' },
  stepLabel: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: C.muted, flex: 1 },
  inProgress:{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: C.accent, fontStyle: 'italic' },
  doneBadge: { backgroundColor: '#7A9E6E15', borderWidth: 1.5, borderColor: '#7A9E6E40', borderRadius: 14, padding: 13, paddingHorizontal: 20 },
  doneText:  { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#7A9E6E' },
});
