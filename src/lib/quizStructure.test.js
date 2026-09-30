// Guards the split between quiz STRUCTURE (src/constants.js) and quiz TEXT (locales/*/quiz.json).
//  1. constants.js must not hold any text again (no string/function properties outside an allow-list).
//  2. Every text the quiz screens read must exist in the English file, and the English file must
//     not contain texts that nothing reads (typos in a question id, option value, ...).
//  3. Option values / field keys are used inside i18n keys, so they must not contain "." or ":".
jest.mock('./auth'); // constants.js imports api.js -> auth.js, which needs native plugins

const { QUESTIONS, SKIN_TONES } = require('../constants');
const en = require('../locales/en/quiz.json');

// Properties that may be a string or a function (everything else must be a number/boolean/array/object).
// Note: `value`, `id`, `type`, `key`, `emoji`, `icon`, `swatch` are the stored values / symbols.
// `showIf` is the only function (a rule about WHEN a question is shown, not text).
const ALLOWED = new Set([
  'id', 'type', 'emoji', 'icon', 'value', 'showIf', 'exclusive', 'freeText', 'cardStyle',
  'countsInProgress', 'autoAdvanceMs', 'chapterNumber', 'totalChapters', 'stageCount',
  'min', 'max', 'anchors', 'swatch', 'key',
  // containers
  'options', 'extraOptions', 'groups', 'fields',
]);

// Walks an object/array and lists every "path" whose property is not allowed.
function badProperties(node, path, out = []) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => badProperties(child, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (!ALLOWED.has(k)) out.push(`${path}.${k}`);
      badProperties(v, `${path}.${k}`, out);
    }
  }
  return out;
}

// Same walk for the strings themselves: every string value must belong to an allowed property.
describe('constants.js keeps structure only', () => {
  test('QUESTIONS has no text properties', () => {
    expect(badProperties(QUESTIONS, 'QUESTIONS')).toEqual([]);
  });

  test('SKIN_TONES has no text properties', () => {
    expect(badProperties(SKIN_TONES, 'SKIN_TONES')).toEqual([]);
  });

  test('the walker really detects text (self-check)', () => {
    expect(badProperties([{ id: 'x', options: [{ value: 'a', label: 'A' }], question: () => 'Q' }], 'T').sort())
      .toEqual(['T[0].options[0].label', 'T[0].question']);
  });
});

describe('option values and field keys are safe inside i18n keys', () => {
  const keys = [];
  const collect = (list) => (list || []).forEach(o => keys.push(o.value));
  for (const q of QUESTIONS) {
    collect(q.options); collect(q.extraOptions);
    (q.groups || []).forEach(g => collect(g.options));
    (q.fields || []).forEach(f => { keys.push(f.key); collect(f.options); });
  }
  SKIN_TONES.forEach(t => keys.push(t.value));
  QUESTIONS.forEach(q => keys.push(q.id));

  test('no "." or ":" and never empty', () => {
    expect(keys.filter(k => typeof k !== 'string' || k === '' || /[.:]/.test(k))).toEqual([]);
  });

  test('option values are unique inside one question (group options share one key space)', () => {
    for (const q of QUESTIONS) {
      const all = [...(q.options || []), ...(q.groups || []).flatMap(g => g.options)].map(o => o.value);
      expect(`${q.id}: ${all.length}`).toBe(`${q.id}: ${new Set(all).size}`);
    }
  });
});

// Joins a dot path and checks it exists as a string in the English file.
const getEn = (path) => path.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), en);
const isText = (path) => typeof getEn(path) === 'string' && getEn(path).length > 0;

describe('en/quiz.json covers everything the screens read', () => {
  const required = [];
  // shared texts
  [1, 2, 3, 4, 5].forEach(n => required.push(`chapters.${n}`));
  ['stepCounter', 'chapterEyebrow', 'continue', 'next', 'createProfile', 'skipForNow', 'skipQuestion',
    'seeEra', 'tellUsMore', 'noWrongAnswers', 'photoAdded', 'takePhoto', 'upload', 'removeRetake',
    'photoFootnote', 'photoPrivacy', 'completionSub'].forEach(k => required.push(`ui.${k}`));
  ['front', 'left', 'right', 'closeup', 'neck'].forEach(k => required.push(`photoAngles.${k}.label`, `photoAngles.${k}.hint`));
  ['subtitle', 'inProgress', 'done', 'scanWait.reading', 'scanWait.texture', 'scanWait.barrier', 'scanWait.almost']
    .forEach(k => required.push(`loading.${k}`));
  ['placeholder', 'label', 'selected', 'noMatch'].forEach(k => required.push(`location.input.${k}`));

  // per question, derived from the structure
  for (const q of QUESTIONS) {
    if (q.chapterNumber) required.push(`chapters.${q.chapterNumber}`);
    // Every question that is shown as a normal step has a `question` text.
    if (!['welcome', 'greeting', 'interstitial', 'completion'].includes(q.type)) required.push(`${q.id}.question`);
    (q.options || []).forEach(o => required.push(`${q.id}.options.${o.value}.label`));
    (q.extraOptions || []).forEach(o => required.push(`${q.id}.extraOptions.${o.value}.label`));
    (q.groups || []).forEach((g, gi) => {
      required.push(`${q.id}.groups.${gi}`);
      g.options.forEach(o => required.push(`${q.id}.options.${o.value}.label`));
    });
    (q.fields || []).forEach(f => {
      if (q.type === 'hormones') required.push(`${q.id}.fields.${f.key}.label`);
      (f.options || []).forEach(o => required.push(`${q.id}.fields.${f.key}.options.${o.value}.label`));
    });
    if (q.type === 'slider') for (let n = q.min; n <= q.max; n++) required.push(`${q.id}.labels.${n}`);
    if (q.type === 'single' && q.cardStyle) (q.options || []).forEach(o => required.push(`${q.id}.options.${o.value}.desc`));
    if (q.type === 'welcome') ['header', 'body', 'timeNote', 'cta', 'footer', 'checklist.0'].forEach(k => required.push(`welcome.${k}`));
    if (q.type === 'greeting') required.push(`${q.id}.text`, `${q.id}.textNoName`);
    if (q.type === 'interstitial') required.push(`${q.id}.headline`);
    if (q.type === 'name') required.push(`${q.id}.placeholder`);
    if (q.type === 'completion') {
      required.push(`${q.id}.headline`, `${q.id}.headlineNoName`);
      for (let i = 0; i < q.stageCount; i++) required.push(`${q.id}.stages.${i}`);
    }
  }
  SKIN_TONES.forEach(t => required.push(`tone.options.${t.value}.label`, `tone.options.${t.value}.sub`));
  // The priority question shows the skin_goals options.
  const unique = [...new Set(required)];

  test('every required text exists in en/quiz.json', () => {
    expect(unique.filter(p => !isText(p))).toEqual([]);
  });

  test('the loading stage count matches the number of English stage texts', () => {
    const completion = QUESTIONS.find(q => q.id === 'completion');
    expect(en.completion.stages).toHaveLength(completion.stageCount);
  });

  test('every text that mentions {{name}} has a "NoName" twin without it', () => {
    const problems = [];
    (function walk(node, path) {
      for (const [k, v] of Object.entries(node)) {
        const p = path ? `${path}.${k}` : k;
        if (v && typeof v === 'object') walk(v, p);
        else if (typeof v === 'string' && v.includes('{{name}}')) {
          const twin = getEn(`${p}NoName`);
          if (typeof twin !== 'string' || twin.includes('{{')) problems.push(p);
        }
      }
    })(en, '');
    expect(problems).toEqual([]);
  });

  test('no English text is left over that nothing can read (typo guard)', () => {
    // Which sub-keys a question id may have, and which ids exist.
    const ids = new Set(QUESTIONS.map(q => q.id));
    const textFields = new Set(['question', 'questionNoName', 'why', 'fact', 'hint', 'tip', 'placeholder', 'headline',
      'headlineNoName', 'header', 'body', 'timeNote', 'cta', 'footer', 'text', 'textNoName']);
    const top = new Set(['chapters', 'ui', 'photoAngles', 'loading']);
    const stray = [];
    (function walk(node, path) {
      for (const [k, v] of Object.entries(node)) {
        const p = path ? `${path}.${k}` : k;
        if (v && typeof v === 'object') walk(v, p);
        else {
          const parts = p.split('.');
          const [first, second] = parts;
          const ok = top.has(first)
            || (ids.has(first) && (textFields.has(second)
              || ['options', 'extraOptions', 'groups', 'fields', 'labels', 'checklist', 'stages', 'input'].includes(second)));
          if (!ok) stray.push(p);
        }
      }
    })(en, '');
    expect(stray).toEqual([]);

    // Option values named in the file must exist in the structure of that question.
    const values = (q) => new Set([
      ...(q.options || []).map(o => o.value), ...(q.extraOptions || []).map(o => o.value),
      ...(q.groups || []).flatMap(g => g.options.map(o => o.value)),
      ...(q.type === 'tone' ? SKIN_TONES.map(t => t.value) : []),
    ]);
    const unknown = [];
    for (const q of QUESTIONS) {
      const node = en[q.id];
      if (!node) continue;
      const known = values(q);
      for (const bucket of ['options', 'extraOptions']) {
        for (const v of Object.keys(node[bucket] || {})) if (!known.has(v)) unknown.push(`${q.id}.${bucket}.${v}`);
      }
      const keys = new Set((q.fields || []).map(f => f.key));
      for (const f of Object.keys(node.fields || {})) if (!keys.has(f)) unknown.push(`${q.id}.fields.${f}`);
    }
    expect(unknown).toEqual([]);
  });
});
