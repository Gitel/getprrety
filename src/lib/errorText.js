import i18n from './i18n';

// Turns an error thrown by api.js into text for the screen, in the current language.
//
//   errorText(err, t)                      -> generic fallback
//   errorText(err, t, 'auth:login.failed')  -> screen-specific fallback
//
// `t` is the function from useTranslation(). We never show err.message: it is the server's
// English sentence, and the UI may be Hebrew (or the server may be an old one without codes).
// Interpolation values we accept from err.params. The object comes from the server, and i18next
// treats some option names specially (lng, ns, defaultValue, ...), so only plain own properties with
// a string or number value are passed on, and those reserved names are dropped.
const RESERVED_OPTIONS = new Set([
  'lng', 'lngs', 'ns', 'defaultValue', 'returnObjects', 'returnDetails', 'joinArrays', 'postProcess',
  'interpolation', 'context', 'count', 'keySeparator', 'nsSeparator', 'fallbackLng', 'replace',
]);
function safeParams(params) {
  const out = {};
  if (!params || typeof params !== 'object') return out;
  for (const key of Object.keys(params)) { // own enumerable properties only
    const value = params[key];
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    // `count` drives plurals, so a number is fine; a string count is not.
    if (RESERVED_OPTIONS.has(key) && !(key === 'count' && typeof value === 'number')) continue;
    out[key] = value;
  }
  return out;
}

export function errorText(err, t, fallbackKey = 'errors:generic') {
  const code = err && err.code;

  // Only accept plain code names, so a strange value can never build an odd translation key.
  // We check i18n.exists first because i18next returns the KEY ITSELF (e.g. "errors:foo")
  // when a key is missing, and that would end up on screen.
  if (typeof code === 'string' && /^[a-z_]+$/i.test(code) && i18n.exists(`errors:${code}`)) {
    return t(`errors:${code}`, safeParams(err && err.params));
  }

  // A server failure with no known code: a generic "our side" message is better than the fallback.
  if (err && err.status >= 500) return t('errors:server_error');

  return t(fallbackKey);
}
