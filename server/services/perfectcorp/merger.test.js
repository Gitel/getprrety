const { merge } = require('./merger');
const { AnalysisError } = require('./errors');
const { toSeverity } = require('./severityBands');

function makeAnalysis(overrides = {}) {
  return {
    angle: 'front',
    concerns: {
      acne: { raw: 90, ui: 90, severity: toSeverity(90) },
      pore: { raw: 60, ui: 60, severity: toSeverity(60) },
      redness: { raw: 70, ui: 70, severity: toSeverity(70) },
      moisture: { raw: 50, ui: 50, severity: toSeverity(50) },
    },
    skinType: { whole: 'Combination' },
    ...overrides,
  };
}

describe('merge', () => {
  test('throws when the front photo is missing', () => {
    expect(() => merge(null, [])).toThrow(AnalysisError);
  });

  test('front-only succeeds when there are no side photos', () => {
    const front = makeAnalysis();
    const merged = merge(front, []);
    expect(merged.concerns).toEqual(front.concerns);
    expect(merged.mergeMeta).toEqual({ sidesAttempted: 0, sidesUsed: 0 });
  });

  test('front-only succeeds when both sides fail — sides never block completion', () => {
    const front = makeAnalysis();
    const sides = [{ failed: true }, { failed: true }];
    const merged = merge(front, sides);
    expect(merged.concerns).toEqual(front.concerns);
    expect(merged.mergeMeta).toEqual({ sidesAttempted: 2, sidesUsed: 0 });
  });

  test('averages a lateral concern (pore) across front (2x weight) and a valid side', () => {
    const front = makeAnalysis(); // pore raw 60
    const left = makeAnalysis({ concerns: { ...makeAnalysis().concerns, pore: { raw: 66, ui: 66, severity: toSeverity(66) } } });
    const merged = merge(front, [left]);
    // (60*2 + 66) / 3 = 62
    expect(merged.concerns.pore.raw).toBeCloseTo(62);
    expect(merged.mergeMeta.sidesUsed).toBe(1);
  });

  test('discards a side sample that is an outlier (>25 points from front)', () => {
    const front = makeAnalysis(); // pore raw 60
    const outlierSide = makeAnalysis({ concerns: { ...makeAnalysis().concerns, pore: { raw: 30, ui: 30, severity: toSeverity(30) } } });
    const merged = merge(front, [outlierSide]);
    expect(merged.concerns.pore.raw).toBe(60); // untouched — outlier discarded for this concern
    // mergeMeta.sidesUsed counts sides that responded at all (not per-concern outlier filtering) —
    // this side is still "used" for whichever lateral concerns it wasn't an outlier on (redness here).
    expect(merged.mergeMeta.sidesUsed).toBe(1);
  });

  test('never lets a side photo influence a non-lateral concern (acne)', () => {
    const front = makeAnalysis(); // acne raw 90
    const side = makeAnalysis({ concerns: { ...makeAnalysis().concerns, acne: { raw: 10, ui: 10, severity: toSeverity(10) } } });
    const merged = merge(front, [side]);
    expect(merged.concerns.acne.raw).toBe(90);
  });

  test('SIDE_PHOTO_ANALYSIS_ENABLED=false ignores sides entirely regardless of validity', () => {
    const front = makeAnalysis();
    const left = makeAnalysis({ concerns: { ...makeAnalysis().concerns, pore: { raw: 66, ui: 66, severity: toSeverity(66) } } });
    const merged = merge(front, [left], { sidePhotoAnalysisEnabled: false });
    expect(merged.concerns.pore.raw).toBe(60);
    expect(merged.mergeMeta).toEqual({ sidesAttempted: 1, sidesUsed: 0 });
  });
});
