// The ONE i18next instance for the whole app. It initialises synchronously when imported
// (src/main.jsx imports it before rendering), so `t()` works on the very first render.
//
// Not here on purpose: saving the chosen language and switching it from the UI. Those come in
// later tasks; for now the app always starts in English.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources, NAMESPACES } from '../locales';
import { DEFAULT_LANGUAGE, dirFor, normalizeLanguage } from './language';

// Keeps <html lang> and <html dir> in step with the current language. Modal content is rendered
// in <body>, outside the root View, so it needs the html-level dir as well (see plan RTL rules).
function applyHtmlAttributes(lng) {
  if (typeof document === 'undefined') return; // jest/node has no document
  const lang = normalizeLanguage(lng) || DEFAULT_LANGUAGE;
  document.documentElement.lang = lang;
  document.documentElement.dir = dirFor(lang);
}

// Returns 'rtl' or 'ltr' for the language that is active right now.
export function currentDir() {
  return dirFor(i18n.language);
}

i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: 'en',
  ns: NAMESPACES,
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
  initAsync: false, // load the bundled resources immediately instead of in a setTimeout
  react: { useSuspense: false },
});

// Later language changes update <html> too; the initial language is set once here.
i18n.on('languageChanged', applyHtmlAttributes);
applyHtmlAttributes(i18n.language);

export default i18n;
