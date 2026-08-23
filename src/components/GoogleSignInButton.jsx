import React, { useEffect, useState } from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import { C } from '../constants';

WebBrowser.maybeCompleteAuthSession();

const discovery = { authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth' };

const CLIENT_ID = Platform.select({
  ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  default: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

// Native "Sign in with Google": Google's implicit id_token flow via the system browser
// (expo-auth-session + expo-web-browser), no native SDK/dev-client build required.
export default function GoogleSignInButton({ onToken, onError, loading, label = 'Continue with Google' }) {
  const [nonce] = useState(() => Crypto.randomUUID());
  const redirectUri = AuthSession.makeRedirectUri();

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID,
      responseType: AuthSession.ResponseType.IdToken,
      scopes: ['openid', 'profile', 'email'],
      redirectUri,
      usePKCE: false,
      extraParams: { nonce },
    },
    discovery
  );

  useEffect(() => {
    if (!response) return;
    if (response.type === 'success' && response.params?.id_token) {
      onToken(response.params.id_token);
    } else if (response.type === 'error') {
      onError?.(response.error?.message || 'Google sign-in failed.');
    }
  }, [response]);

  if (!CLIENT_ID) return null;
  const isDisabled = !request || loading;

  return (
    <Pressable
      disabled={isDisabled}
      onPress={() => promptAsync()}
      style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }, isDisabled && s.btnDisabled]}
    >
      {loading ? (
        <ActivityIndicator color={C.text} size="small" />
      ) : (
        <>
          <Text style={s.icon}>G</Text>
          <Text style={s.text}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: C.border, borderRadius: 13, paddingVertical: 14, marginBottom: 12 },
  btnDisabled: { opacity: 0.5 },
  icon: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#4285F4' },
  text: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: C.text },
});
