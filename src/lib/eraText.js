// Era text (name / tagline / affirmation) in the current language.
//
// Why English stays in ERAS (src/constants.js): ERAS is kept identical to server/services/eras.js by
// an existing test, the server and saved analyses store English era text, and an admin may have
// edited it. So we never translate the stored data. Instead the UI looks the text up BY ERA ID in
// the Hebrew-only `eras` namespace (src/locales/he/eras.json) when the language is Hebrew, and
// falls back to the English text otherwise. There is intentionally no en/eras.json.
import { ERAS } from '../constants';
import i18n from './i18n';

const FIELDS = ['name', 'tagline', 'affirmation'];

// The English text for a field: the stored era value first (it may be admin-edited), then ERAS by
// id, then ''. Safe for a null/undefined era.
function englishText(era, field) {
  return era?.[field] || ERAS[era?.id]?.[field] || '';
}

// Hebrew text for the era id, or '' when there is none (unknown id, missing field).
function hebrewText(era, field) {
  // Only ids that exist in ERAS: an id like "constructor" must not reach the resource lookup.
  if (!era?.id || !Object.prototype.hasOwnProperty.call(ERAS, era.id) || !FIELDS.includes(field)) return '';
  const text = i18n.getResource('he', 'eras', `${era.id}.${field}`);
  return typeof text === 'string' ? text : '';
}

// field: 'name' | 'tagline' | 'affirmation'. lang: 'he' | 'en' (anything else behaves like 'en').
export function eraText(era, field, lang) {
  if (lang === 'he') {
    const he = hebrewText(era, field);
    if (he) return he;
  }
  return englishText(era, field);
}

// The affirmation shown for an analysis. The app shows `analysis.affirmation || era.affirmation`.
// The fallback analysis and the Railway path copy the ENGLISH era affirmation into
// analysis.affirmation, so in Hebrew that copy would show English. Rule: if the stored text equals
// the English ERAS template for this era (trimmed), it is not real custom text, so show the Hebrew
// era affirmation. Gemini/admin-written text is anything else and stays exactly as written.
export function analysisAffirmation(analysis, lang) {
  const era = analysis?.era || ERAS[analysis?.eraId];
  const stored = typeof analysis?.affirmation === 'string' ? analysis.affirmation : '';
  if (stored.trim()) {
    const template = ERAS[era?.id]?.affirmation;
    if (lang === 'he' && template && stored.trim() === template.trim()) {
      return eraText(era, 'affirmation', lang);
    }
    return stored;
  }
  return eraText(era, 'affirmation', lang);
}
