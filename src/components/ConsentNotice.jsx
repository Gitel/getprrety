import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTranslation, Trans } from 'react-i18next';
import { C } from '../constants';
import { TERMS_URL, PRIVACY_URL, LEGAL_READY, missingLegalConfig, openLegal } from '../lib/consent';

// Binding consent copy shown on the auth screens (LoginScreen, SignUpScreen).
// Tapping the CTA is the act of acceptance; this text makes that explicit and links
// out to the policies. When legal links aren't configured, onboarding is blocked and
// we say so instead.
export default function ConsentNotice({ style }) {
  const { t } = useTranslation();
  if (!LEGAL_READY) {
    // Name the pieces that are actually unset. The old copy blamed the two policy
    // links even when the real problem was the configured consent version, sending
    // whoever debugs a dead CTA to check the wrong secrets.
    // missingLegalConfig() returns stable English ids (not display text); translate them here.
    const labels = {
      'Terms link': t('auth:consent.missing.terms'),
      'Privacy link': t('auth:consent.missing.privacy'),
      'consent version': t('auth:consent.missing.version'),
    };
    const items = missingLegalConfig().map(id => labels[id] || id).join(', ');
    return (
      <Text style={[s.error, style]}>
        {t('auth:consent.disabled', { items })}
      </Text>
    );
  }
  return (
    <Text style={[s.text, style]}>
      {/* <Trans> puts the two tappable links inside the translated sentence, so each language
          can order the words its own way. <terms>/<privacy> in the text map to the Texts below. */}
      <Trans
        i18nKey="auth:consent.agree"
        components={{
          terms: <Text style={s.link} onPress={() => openLegal(TERMS_URL)} />,
          privacy: <Text style={s.link} onPress={() => openLegal(PRIVACY_URL)} />,
          // <sp/> is a plain space kept as its OWN text node. The English text was originally written
          // as separate JSX pieces; one merged text node would shift a glyph by a sub-pixel, so
          // the English screens would no longer be pixel-identical. Keep <sp/> in every language.
          sp: <React.Fragment>{' '}</React.Fragment>,
        }}
      />
    </Text>
  );
}

const s = StyleSheet.create({
  text: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: C.muted,
    lineHeight: 18,
    textAlign: 'center',
  },
  link: { fontFamily: 'DMSans_500Medium', color: C.accent, textDecorationLine: 'underline' },
  error: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: '#C44B4B',
    textAlign: 'center',
  },
});
