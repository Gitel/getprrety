import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { C } from '../constants';

const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

// Web "Sign in with Google": Google Identity Services renders its own button into
// our div and hands back a signed credential (id_token) via the callback.
export default function GoogleSignInButton({ onToken, onError, loading }) {
  const divRef = useRef(null);

  useEffect(() => {
    if (!CLIENT_ID || loading) return;

    function renderButton() {
      if (!window.google?.accounts?.id || !divRef.current) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (resp) => {
          if (resp?.credential) onToken(resp.credential);
          else onError?.('Google sign-in failed.');
        },
      });
      window.google.accounts.id.renderButton(divRef.current, {
        theme: 'outline', size: 'large', width: 320, text: 'continue_with',
      });
    }

    if (window.google?.accounts?.id) {
      renderButton();
      return;
    }

    let script = document.getElementById('google-identity-script');
    if (!script) {
      script = document.createElement('script');
      script.id = 'google-identity-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', renderButton);
    return () => script.removeEventListener('load', renderButton);
  }, [loading]);

  if (!CLIENT_ID) return null;

  return (
    <View style={s.wrap}>
      {loading ? <ActivityIndicator color={C.text} /> : <View ref={divRef} />}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', width: '100%', marginBottom: 12, minHeight: 44, justifyContent: 'center' },
});
