// Test-side translation helper: reads the app's own locale files so specs never hard-code text.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = fileURLToPath(new URL('../../src/locales/', import.meta.url));
const cache = new Map();

// Loads (and caches) src/locales/<lang>/<ns>.json; null when the file does not exist.
function loadNamespace(lang, ns) {
  const id = `${lang}/${ns}`;
  if (!cache.has(id)) {
    const file = `${LOCALES_DIR}${lang}/${ns}.json`;
    cache.set(id, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
  }
  return cache.get(id);
}

// Walks "a.b.c" down a nested object; returns a string or undefined.
function lookup(obj, path) {
  let node = obj;
  for (const part of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

// Finds the raw template for a key in one language. With vars.count it also tries the
// i18next plural forms (key_one / key_other ...) chosen by Intl.PluralRules.
function findTemplate(lang, ns, path, vars) {
  const data = loadNamespace(lang, ns);
  if (!data) return undefined;
  if (vars && typeof vars.count === 'number') {
    const form = new Intl.PluralRules(lang).select(vars.count);
    const plural = lookup(data, `${path}_${form}`) ?? lookup(data, `${path}_other`);
    if (plural !== undefined) return plural;
  }
  return lookup(data, path);
}

// Creates t('ns:some.key', { var }) for one language. Falls back to English when the key is
// missing in that language and THROWS when it is missing everywhere (a typo must fail loudly).
export function makeT(lang) {
  return function t(key, vars) {
    const sep = key.indexOf(':');
    if (sep < 0) throw new Error(`t("${key}"): use the "namespace:path" form`);
    const ns = key.slice(0, sep);
    const path = key.slice(sep + 1);
    const template = findTemplate(lang, ns, path, vars) ?? findTemplate('en', ns, path, vars);
    if (template === undefined) throw new Error(`t("${key}"): key not found in src/locales/${lang} or en`);
    // {{var}} interpolation, like i18next (escaping is off in the app).
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name) => {
      if (!vars || !(name in vars)) throw new Error(`t("${key}"): missing variable "${name}"`);
      return String(vars[name]);
    });
  };
}
