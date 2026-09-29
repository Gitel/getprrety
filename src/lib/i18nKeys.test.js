// Static-keys gate. Scans the source for literal t('ns:key') calls and checks each key exists in
// the English resources, so a typo or a forgotten key fails here instead of showing a raw key.
// Keys built at run time (t(`a.${x}`)) cannot be checked here; those need their own tests.
const fs = require('fs');
const path = require('path');
const { resources } = require('../locales');

const SRC = path.join(__dirname, '..');
const ROOT_APP = path.join(SRC, '..', 'App.jsx');
const SKIP_FILE = path.join(SRC, 'App.jsx'); // dead prototype, not part of the app

// All .js/.jsx files under src, without tests and the dead src/App.jsx.
function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'locales') sourceFiles(full, out);
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) && full !== SKIP_FILE) {
      out.push(full);
    }
  }
  return out;
}

// Matches t('...'), t("..."), i18n.t('...') and i18next.t('...'); \b keeps out e.g. split('x').
const CALL_RE = /(?:^|[^\w$.])(?:(?:i18n|i18next)\.)?t\(\s*(['"])((?:(?!\1)[^\\\n])*)\1/g;

// Returns every literal key used in a file's text.
function literalKeys(text) {
  const keys = [];
  for (const m of text.matchAll(CALL_RE)) keys.push(m[2]);
  return keys;
}

// True when `key` (dot path, no namespace) exists in an English namespace object.
function existsIn(obj, key) {
  const walk = k => k.split('.').reduce((o, part) => (o && typeof o === 'object' ? o[part] : undefined), obj);
  if (typeof walk(key) === 'string') return true;
  // Plural keys are stored as key_one / key_other, so the base key counts as existing.
  return typeof walk(`${key}_one`) === 'string' || typeof walk(`${key}_other`) === 'string';
}

describe('literal t() keys', () => {
  test('the scanner finds calls and ignores lookalikes', () => {
    expect(literalKeys("t('a:b') t(\"c:d.e\") i18n.t('f:g') foo.split('x') sprint('y')")).toEqual(['a:b', 'c:d.e', 'f:g']);
  });

  test('every literal key has a namespace and exists in the English resources', () => {
    const files = [...sourceFiles(SRC), ROOT_APP];
    const problems = [];
    for (const file of files) {
      for (const key of literalKeys(fs.readFileSync(file, 'utf8'))) {
        const rel = path.relative(path.join(SRC, '..'), file);
        const idx = key.indexOf(':');
        if (idx < 1) {
          problems.push(`${rel}: "${key}" has no "ns:" prefix`);
          continue;
        }
        const ns = key.slice(0, idx);
        const rest = key.slice(idx + 1);
        if (!resources.en[ns]) problems.push(`${rel}: "${key}" uses unknown English namespace "${ns}"`);
        else if (!existsIn(resources.en[ns], rest)) problems.push(`${rel}: "${key}" is missing from en/${ns}.json`);
      }
    }
    expect(problems).toEqual([]);
  });
});
