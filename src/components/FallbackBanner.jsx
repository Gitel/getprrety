import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useApp } from '../context/AppContext';
import { startRetake } from '../lib/retake';

// Shown on Profile and Home when the analysis is the generic fallback template
// (analysis.source === 'fallback': the Gemini analysis failed). Without it, users read
// the canned routine as a personal one.
//
// The action depends on what is still in memory:
//  - quiz answers + photos present (same session as the quiz) -> "Try again" re-runs the
//    analysis on LoadingScreen with the same answers, no re-quiz;
//  - otherwise (e.g. a saved fallback loaded after a reload)   -> "Retake assessment".
export default function FallbackBanner({ analysis, navigation }) {
  const { answers, user, setAnalysis, setAnswers } = useApp();
  if (analysis?.source !== 'fallback') return null;

  const canRetry = Boolean(answers);

  function onPress() {
    if (canRetry) {
      // replace, not navigate: keeps the stack from growing on repeated retries.
      // `retry` tells LoadingScreen not to save a second identical fallback.
      navigation.replace('Loading', { retry: true });
    } else {
      startRetake({ navigation, user, setAnalysis, setAnswers });
    }
  }

  return (
    <View style={s.banner}>
      <Text style={s.title}>We couldn't personalize your plan right now</Text>
      <Text style={s.body}>
        This is our general starter plan, not a reading of your skin. Please try again in a little while.
      </Text>
      <Pressable onPress={onPress} style={s.btn} hitSlop={6}>
        <Text style={s.btnText}>{canRetry ? 'Try again' : 'Retake assessment'}</Text>
      </Pressable>
    </View>
  );
}

// Same palette as ProfileScreen's "couldn't save" banner, so warnings look consistent.
const s = StyleSheet.create({
  banner:  { backgroundColor: '#FBEEE9', borderWidth: 1, borderColor: '#E4B7A6', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 18 },
  title:   { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#9A5B44', marginBottom: 4 },
  body:    { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#9A5B44', lineHeight: 17, marginBottom: 10 },
  btn:     { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#9A5B44', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  btnText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#9A5B44' },
});
