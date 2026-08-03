const { toSeverity, toSeverityLabel } = require('./severityBands');

describe('toSeverity — score direction', () => {
  // Higher raw_score = healthier skin. If this ever flips, every downstream recommendation is
  // exactly backwards. This is the single highest-risk bug in the whole integration.
  test('a high score (skin doing well) maps to LOW severity', () => {
    expect(toSeverity(93.98)).toBe(0);
  });

  test('a low score (concern present) maps to HIGH severity', () => {
    expect(toSeverity(48.94)).toBe(3);
  });

  test('band boundaries are inclusive of their minimum', () => {
    expect(toSeverity(80)).toBe(0);
    expect(toSeverity(79.99)).toBe(1);
    expect(toSeverity(65)).toBe(1);
    expect(toSeverity(50)).toBe(2);
    expect(toSeverity(35)).toBe(3);
    expect(toSeverity(0)).toBe(4);
  });

  test('labels move in the same direction as severity', () => {
    expect(toSeverityLabel(93.98)).toBe('strong');
    expect(toSeverityLabel(48.94)).toBe('needsWork');
  });
});
