import React, { useEffect, useRef, useState } from 'react';
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
  const { authReady, user, analysis, afterSignin, clearAfterSignin, linkWelcome, linkPending } = useApp();
  const [gaveUp, setGaveUp] = useState(false);
  // The redirect effect can fire twice — once when authReady flips, once if the
  // gaveUp timer wins the race against unmount — and navigation.replace is not
  // itself idempotent against being called twice in a row.
  const navigated = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!authReady && !gaveUp) return;
    // A sign-in link is still being redeemed: wait for its result even if the ceiling passed,
    // otherwise an invitee on a slow network would skip the welcome screen.
    if (linkPending) return;
    if (navigated.current) return;
    // Sign-in link results (set by AppContext boot). reset, not replace, so Splash is gone
    // from the stack and the chosen screen is the only one.
    if (linkWelcome) {
      // Invite needing consent, or a dead link: LinkWelcomeScreen shows which one.
      navigated.current = true;
      navigation.reset({ index: 0, routes: [{ name: 'LinkWelcome', params: linkWelcome }] });
      return;
    }
    if (afterSignin) {
      // A link just signed the user in: go to the quiz landing once (one-shot flag).
      navigated.current = true;
      clearAfterSignin();
      navigation.reset({ index: 0, routes: [{ name: afterSignin }] });
      return;
    }
    if (user) {
      navigated.current = true;
      // A returning client can still arrive on a clinic link, and WelcomeScreen is the
      // only place referralSource is captured — skipping it writes the retake with no
      // attribution at all. Someone who already has a result still goes straight Home.
      navigation.replace(analysis ? 'Home' : (getWelcomeRef() ? 'Welcome' : 'QuizIntro'));
      return;
    }
    navigated.current = true;
    // Quiz-first: a signed-out user lands on the skin-analysis intro (or the clinic
    // Welcome screen when a recognized ?ref= is present). Existing users reach Login
    // from the "Already have an account? Log in" control on those screens.
    navigation.replace(getWelcomeRef() ? 'Welcome' : 'QuizIntro');
  }, [authReady, gaveUp, user, analysis, linkPending, linkWelcome, afterSignin]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={C.accent} size="large" />
    </View>
  );
}
