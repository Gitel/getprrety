import i18n from './i18n';

// Turns an error thrown by api.js into text for the screen, in the current language.
//
//   errorText(err, t)                      -> generic fallback
//   errorText(err, t, 'auth:loginFailed')  -> screen-specific fallback
//
// `t` is the function from useTranslation(). We never show err.message: it is the server's
// English sentence, and the UI may be Hebrew (or the server may be an old one without codes).
export function errorText(err, t, fallbackKey = 'errors:generic') {
  const code = err && err.code;

  // Only accept plain code names, so a strange value can never build an odd translation key.
  // We check i18n.exists first because i18next returns the KEY ITSELF (e.g. "errors:foo")
  // when a key is missing, and that would end up on screen.
  if (typeof code === 'string' && /^[a-z_]+$/i.test(code) && i18n.exists(`errors:${code}`)) {
    return t(`errors:${code}`, (err && err.params) || {});
  }

  // A server failure with no known code: a generic "our side" message is better than the fallback.
  if (err && err.status >= 500) return t('errors:server_error');

  return t(fallbackKey);
}
