const {
  quizBaselineSeverity, fuse, agreementFor, resolveSkinType, runFusion,
} = require('./fusionEngine');

describe('quizBaselineSeverity', () => {
  test('top concern (only asked when >=2 goals selected) is the strongest signal', () => {
    const answers = { skin_goals: ['acne', 'large_pores'], top_concern: 'acne' };
    expect(quizBaselineSeverity('acne', answers)).toBe(3);
  });

  test('a mentioned-but-not-prioritized goal is a moderate signal', () => {
    const answers = { skin_goals: ['acne', 'large_pores'], top_concern: 'acne' };
    expect(quizBaselineSeverity('pore', answers)).toBe(2);
  });

  test('an unmentioned concern gets the neutral prior', () => {
    expect(quizBaselineSeverity('wrinkle', { skin_goals: ['acne'] })).toBe(1);
  });
});

describe('fuse — the API may move severity by at most one level', () => {
  test('clamps a large upward disagreement to +1', () => {
    expect(fuse(0, 4)).toBe(1);
  });

  test('clamps a large downward disagreement to -1', () => {
    expect(fuse(4, 0)).toBe(3);
  });

  test('agreement passes through unchanged', () => {
    expect(fuse(2, 2)).toBe(2);
  });

  test('output is always clamped to the 0-4 range', () => {
    expect(fuse(0, 0)).toBe(0);
    expect(fuse(4, 4)).toBe(4);
  });
});

describe('agreementFor', () => {
  test('equal severities are aligned', () => expect(agreementFor(3, 3)).toBe('aligned'));
  test('api one level higher', () => expect(agreementFor(1, 2)).toBe('api_higher'));
  test('api one level lower', () => expect(agreementFor(2, 1)).toBe('api_lower'));
  test('a gap of 2+ is a contradiction', () => expect(agreementFor(0, 3)).toBe('contradiction'));
});

describe('resolveSkinType — the dehydrated-but-oily-T-zone case', () => {
  test('dry-reported + oily T-zone observed resolves to dehydrated_combination', () => {
    const resolved = resolveSkinType('dry', { whole: 'Combination', tZone: 'Oily', uZone: 'Normal' });
    expect(resolved).toEqual({
      reported: 'Dry', observed: 'Combination', resolved: 'dehydrated_combination', tZone: 'Oily', uZone: 'Normal',
    });
  });

  test('aligned report/observation resolves to the observed type', () => {
    const resolved = resolveSkinType('comfortable', { whole: 'Normal' });
    expect(resolved.resolved).toBe('normal');
  });
});

describe('runFusion', () => {
  const answers = { skin_goals: ['dryness'], post_cleanse_feel: 'dry' }; // single goal — no top_concern asked
  const skinType = { whole: 'Combination', tZone: 'Oily', uZone: 'Normal' };
  const concerns = {
    acne: { severity: 0, ui: 91, raw: 93.98 },
    pore: { severity: 2, ui: 69, raw: 52.34 },
    texture: { severity: 0, ui: 84, raw: 88.17 },
    redness: { severity: 1, ui: 75, raw: 68.27 },
    oiliness: { severity: 3, ui: 40, raw: 40 }, // never mentioned in the quiz, but the photo disagrees hard
    moisture: { severity: 3, ui: 70, raw: 48.94 },
    radiance: { severity: 1, ui: 79, raw: 76.80 },
    // wrinkle intentionally omitted — simulates a concern the vendor didn't return
  };

  const result = runFusion({ answers, concerns, skinType });

  test('never emits a skinEra field — Era selection is out of scope by design', () => {
    expect(result.skinEra).toBeUndefined();
  });

  test('an unspoken high-severity finding surfaces as a discovery, not a promoted concern', () => {
    expect(result.discoveries).toEqual([{ key: 'oiliness', severity: 3, copyKey: 'discovery.oiliness.mild' }]);
  });

  test('a large quiz/photo gap is logged as a contradiction and resolved via skin type', () => {
    expect(result.contradictions).toEqual([
      { key: 'oiliness', quiz: 1, api: 3, resolution: 'dehydrated_combination' },
    ]);
  });

  test('a concern the vendor never returned falls back to the quiz-only baseline', () => {
    const wrinkleRow = result.concerns.find(c => c.key === 'wrinkle');
    expect(wrinkleRow).toMatchObject({ quizSeverity: 1, apiSeverity: null, severity: 1, agreement: 'quiz_only' });
  });

  test('concerns are ranked by fused severity, most severe first', () => {
    const severities = result.concerns.map(c => c.severity);
    expect(severities).toEqual([...severities].sort((a, b) => b - a));
  });
});
