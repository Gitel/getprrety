// Pure language helpers (no imports, safe to use anywhere, including unit tests).
// The app supports English and Hebrew; English is the default (decision D7).

export const SUPPORTED_LANGUAGES = ['en', 'he'];
export const DEFAULT_LANGUAGE = 'en';

// Turns anything that looks like a language code into 'en' | 'he', or null when unsupported.
// Accepts region variants ('he-IL', 'en_US'), any casing ('HE') and the legacy Hebrew code 'iw'.
export function normalizeLanguage(value) {
  if (typeof value !== 'string') return null;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  if (base === 'iw') return 'he';
  return SUPPORTED_LANGUAGES.includes(base) ? base : null;
}

// True when the language is written right to left (only Hebrew for now).
export function isRTL(lang) {
  return normalizeLanguage(lang) === 'he';
}

// Value for the HTML/react-native-web `dir` attribute. Unknown languages count as English (ltr).
export function dirFor(lang) {
  return isRTL(lang) ? 'rtl' : 'ltr';
}
