import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import { getWelcomeRef } from '../lib/welcomeVariants';

// Belt and braces on top of AppContext's own bootstrap ceiling: whatever wedges —
// a stalled request, a storage read that never returns — this screen is the one the
// user is staring at, so it must never be the last thing that happens.
const SPLASH_MAX_MS = 10000;

// Transient startup gate: the navigator always opens here. While auth is resolving we
// show a spinner; once it's ready we redirect exactly once and never render the app's
// first real screen twice. This is what routes a returning, signed-in user straight to
// Home instead of dropping everyone back into onboarding on every cold start.
export default function SplashScreen({ navigation }) {
  const { authReady, user, analysis } = useApp();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!authReady && !gaveUp) return;
    if (user) {
      navigation.replace(analysis ? 'Home' : 'QuizIntro');
      return;
    }
    navigation.replace(getWelcomeRef() ? 'Welcome' : 'QuizIntro');
  }, [authReady, gaveUp, user, analysis]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );
}
