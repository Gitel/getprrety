import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import { getWelcomeRef } from '../lib/welcomeVariants';

// Transient startup gate: the navigator always opens here. While auth is resolving we
// show a spinner; once it's ready we redirect exactly once and never render the app's
// first real screen twice. This is what routes a returning, signed-in user straight to
// Home instead of dropping everyone back into onboarding on every cold start.
export default function SplashScreen({ navigation }) {
  const { authReady, user, analysis } = useApp();

  useEffect(() => {
    if (!authReady) return;
    if (user) {
      navigation.replace(analysis ? 'Home' : 'QuizIntro');
      return;
    }
    navigation.replace(getWelcomeRef() ? 'Welcome' : 'QuizIntro');
  }, [authReady, user, analysis]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );
}
