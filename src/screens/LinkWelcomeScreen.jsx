import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { C } from '../constants';
import { useApp } from '../context/AppContext';
import { errorText } from '../lib/errorText';
import { storeToken } from '../lib/auth';
import { consentParams } from '../lib/consent';
import { redeemSigninLink } from '../lib/signinLink';
import ConsentNotice from '../components/ConsentNotice';

// Shown when the app was opened from a clinic sign-in link and the boot could not just sign
// the customer in. Params (from SplashScreen, set by AppContext):
//   { mode: 'invite', token }  a NEW customer invited by the clinic: they must accept the
//                              Terms/Privacy notice before the account is created.
//   { mode: 'invalid' }        the link is expired / used / replaced: say so and continue.
export default function LinkWelcomeScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { clearLinkWelcome, reloadSession } = useApp();
  const params = route?.params || {};
  const isInvite = params.mode === 'invite' && !!params.token;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Both modes end on the normal signed-out landing / quiz start. reset (not replace) makes it
  // the only screen, so Back cannot return to this one.
  function goToLanding() {
    clearLinkWelcome();
    navigation.reset({ index: 0, routes: [{ name: 'QuizIntro' }] });
  }

  async function handleContinue() {
    if (!isInvite) { goToLanding(); return; }
    // Tapping Continue is the act of accepting the notice shown above: take a fresh stamp.
    const consent = consentParams();
    if (!consent) { setError(t('errors:generic')); return; } // legal config missing (ConsentNotice says so)
    setError(null);
    setLoading(true);
    try {
      const res = await redeemSigninLink(params.token, consent);
      await storeToken(res.token);
      await reloadSession(); // fills user + analysis in the context from the new token
      goToLanding();
    } catch (err) {
      setError(errorText(err, t, 'errors:signin_link_failed'));
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} testID="link-welcome-screen">
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.headBlock}>
          <Text style={s.leaf}>🌿</Text>
          <Text style={s.logo}>Get Pretty</Text>
        </View>

        {isInvite ? (
          <>
            <Text style={s.title}>{t('auth:linkInviteTitle')}</Text>
            <Text style={s.body}>{t('auth:linkInviteBody')}</Text>
            <ConsentNotice style={s.consent} />
          </>
        ) : (
          <Text style={s.body} testID="link-invalid">{t('auth:linkInvalid')}</Text>
        )}

        {error && <Text style={s.errorText} testID="link-welcome-error">{error}</Text>}

        <Pressable
          onPress={handleContinue}
          disabled={loading}
          style={[s.cta, loading && s.ctaDisabled]}
          testID="link-welcome-continue"
        >
          {loading
            ? <ActivityIndicator color={C.bg} size="small" />
            : <Text style={s.ctaText}>{t('auth:linkContinue')}</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  content:     { flexGrow: 1, paddingHorizontal: 28, paddingTop: 44, paddingBottom: 40, justifyContent: 'center' },

  headBlock:   { alignItems: 'center', marginBottom: 32 },
  leaf:        { fontSize: 52, marginBottom: 16 },
  logo:        { fontFamily: 'CormorantGaramond_500Medium', fontSize: 36, color: C.text, letterSpacing: 2 },

  title:       { fontFamily: 'CormorantGaramond_500Medium', fontSize: 26, color: C.text, textAlign: 'center', marginBottom: 12 },
  body:        { fontFamily: 'DMSans_400Regular', fontSize: 14, color: C.muted, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  consent:     { marginBottom: 20, paddingHorizontal: 4 },
  errorText:   { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C9897A', marginBottom: 12, textAlign: 'center' },

  cta:         { backgroundColor: '#2C2C2C', borderRadius: 13, paddingVertical: 15, alignItems: 'center' },
  ctaDisabled: { backgroundColor: '#D4CBC4' },
  ctaText:     { fontFamily: 'DMSans_500Medium', fontSize: 15, color: C.bg, letterSpacing: 1.5 },
});
