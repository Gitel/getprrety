// Translation gate. Reads the locale JSON files directly (it does not import i18n.js) and checks
// that English and Hebrew stay in step. Every later translation task must keep this green.
const fs = require('fs');
const path = require('path');
const { NAMESPACES } = require('../locales');

jest.mock('./auth'); // constants.js imports api.js -> auth.js, which needs native plugins

const LOCALES = path.join(__dirname, '..', 'locales');
const PLURAL_RE = /_(zero|one|two|few|many|other)$/;
const HEBREW_LETTER = /[א-ת]/;
const RLM = '‏';

// Hebrew values that may legitimately contain no Hebrew letter (arrows, symbols), as "ns:key".
const NO_HEBREW_ALLOWED = new Set(['common:arrowNext', 'common:arrowBack']);

function readNs(lang, ns) {
  const file = path.join(LOCALES, lang, `${ns}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

// Names of all namespaces that exist as files for a language.
function namespacesOf(lang) {
  return fs.readdirSync(path.join(LOCALES, lang))
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

// Flattens nested JSON to { 'a.b.c': 'text' }.
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

// Splits 'items.count_one' into { base: 'items.count', suffix: 'one' }; suffix is null otherwise.
function splitPlural(key) {
  const m = key.match(PLURAL_RE);
  return m ? { base: key.slice(0, -m[0].length), suffix: m[1] } : { base: key, suffix: null };
}

// Groups a flat map by base key: { base: { '' | suffix: text } }.
function groupByBase(flat) {
  const groups = {};
  for (const [key, text] of Object.entries(flat)) {
    const { base, suffix } = splitPlural(key);
    (groups[base] = groups[base] || {})[suffix || ''] = text;
  }
  return groups;
}

// {{variable}} and <tag> names used by a text.
const vars = text => (String(text).match(/\{\{\s*[\w.]+\s*(?:,[^}]*)?\}\}/g) || []).map(s => s.replace(/\s/g, ''));
const tags = text => (String(text).match(/<\/?\s*[\w-]+/g) || []).map(s => s.replace(/[<\/\s]/g, ''));
const collect = (forms, fn) => new Set(Object.values(forms).flatMap(fn));
// {{count}} may be missing from some plural forms (e.g. "one" -> "a single item"), so ignore it.
const withoutCount = set => new Set([...set].filter(v => !/^\{\{count[,}]/.test(v)));
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const show = set => [...set].sort().join(' ') || '(none)';

// The first "strong" character decides the paragraph direction: Hebrew letters are RTL, Latin LTR.
function firstStrong(text) {
  const m = String(text).match(/[A-Za-zא-ת]/);
  if (!m) return null;
  return HEBREW_LETTER.test(m[0]) ? 'rtl' : 'ltr';
}

const enNamespaces = namespacesOf('en');
const heNamespaces = namespacesOf('he');
const sharedNamespaces = enNamespaces.filter(ns => heNamespaces.includes(ns));

describe('locale files: structure', () => {
  test('every registered namespace has its files (eras is Hebrew-only)', () => {
    expect(NAMESPACES.length).toBeGreaterThan(0);
    for (const ns of NAMESPACES) {
      expect(heNamespaces).toContain(ns);
      if (ns !== 'eras') expect(enNamespaces).toContain(ns);
    }
    expect(enNamespaces).not.toContain('eras');
  });

  test('no locale file is missing from the registry', () => {
    for (const ns of heNamespaces) expect(NAMESPACES).toContain(ns);
  });

  test('English has no namespace that Hebrew lacks', () => {
    for (const ns of enNamespaces) expect(heNamespaces).toContain(ns);
  });
});

describe('locale files: en/he parity', () => {
  test.each(sharedNamespaces)('%s: same base keys, plural forms, variables and tags', ns => {
    const en = groupByBase(flatten(readNs('en', ns)));
    const he = groupByBase(flatten(readNs('he', ns)));
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());

    for (const base of Object.keys(en)) {
      for (const [lang, groups] of [['en', en], ['he', he]]) {
        const forms = groups[base];
        const isPlural = Object.keys(forms).some(s => s !== '');
        if (!isPlural) continue;
        // A key is either plain or plural, never both.
        if ('' in forms) throw new Error(`${lang}/${ns}: "${base}" is both plain and plural`);
        // Every category Intl says this language needs must be present (`many` is optional).
        for (const cat of new Intl.PluralRules(lang).resolvedOptions().pluralCategories) {
          if (!(cat in forms)) throw new Error(`${lang}/${ns}: "${base}" is missing plural form _${cat}`);
        }
      }
      // Same {{variables}} and <tags> over all forms of the key.
      const enVars = withoutCount(collect(en[base], vars));
      const heVars = withoutCount(collect(he[base], vars));
      if (!sameSet(enVars, heVars)) {
        throw new Error(`${ns}:${base} variables differ. en: ${show(enVars)} | he: ${show(heVars)}`);
      }
      const enTags = collect(en[base], tags);
      const heTags = collect(he[base], tags);
      if (!sameSet(enTags, heTags)) {
        throw new Error(`${ns}:${base} tags differ. en: ${show(enTags)} | he: ${show(heTags)}`);
      }
    }
  });
});

describe('locale files: value rules', () => {
  // One row per text: [lang, namespace, key, text]
  const rows = [];
  for (const lang of ['en', 'he']) {
    for (const ns of lang === 'en' ? enNamespaces : heNamespaces) {
      for (const [key, text] of Object.entries(flatten(readNs(lang, ns)))) rows.push([lang, ns, key, text]);
    }
  }
  const hebrewRows = rows.filter(([lang]) => lang === 'he');

  test('no value is empty or not a string', () => {
    const bad = rows.filter(([, , , text]) => typeof text !== 'string' || text.trim() === '');
    expect(bad.map(([l, ns, k]) => `${l}/${ns}:${k}`)).toEqual([]);
  });

  test('every Hebrew value contains a Hebrew letter (unless allow-listed)', () => {
    const bad = hebrewRows
      .filter(([, ns, key, text]) => !HEBREW_LETTER.test(text) && !NO_HEBREW_ALLOWED.has(`${ns}:${key}`))
      .map(([, ns, key]) => `${ns}:${key}`);
    expect(bad).toEqual([]);
  });

  test('RLM rule: a Hebrew value that starts with Latin text or {{ starts with U+200F', () => {
    const bad = hebrewRows
      .filter(([, , , text]) => HEBREW_LETTER.test(text))
      .filter(([, , , text]) => (text.startsWith('{{') || firstStrong(text) === 'ltr') && !text.startsWith(RLM))
      .map(([, ns, key]) => `${ns}:${key}`);
    expect(bad).toEqual([]);
  });

  test('plural suffix helper strips only real plural suffixes', () => {
    expect(splitPlural('items_one')).toEqual({ base: 'items', suffix: 'one' });
    expect(splitPlural('a.b_other')).toEqual({ base: 'a.b', suffix: 'other' });
    expect(splitPlural('nothing_special')).toEqual({ base: 'nothing_special', suffix: null });
  });
});

describe('he/eras.json (Hebrew-only)', () => {
  test('only ERAS ids, with only name/tagline/affirmation', () => {
    const { ERAS } = require('../constants');
    const eras = readNs('he', 'eras');
    expect(eras).not.toBeNull();
    for (const [id, fields] of Object.entries(eras)) {
      expect(Object.keys(ERAS)).toContain(id);
      for (const field of Object.keys(fields)) {
        expect(['name', 'tagline', 'affirmation']).toContain(field);
        expect(typeof fields[field]).toBe('string');
      }
    }
  });
});
