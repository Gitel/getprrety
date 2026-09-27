const { computeSignals, SIGNAL_KEYS } = require('./signals');
const { normalize } = require('../perfectcorp/normalizer');
const { merge } = require('../perfectcorp/merger');
const sampleOutput = require('../perfectcorp/__fixtures__/sampleTaskOutput');

describe('computeSignals', () => {
  // Same path as the poller: normalize the front task, then merge (no side photos).
  const merged = merge(normalize({ output: sampleOutput, angle: 'front' }), []);
  const result = computeSignals(merged);
  const byKey = Object.fromEntries(result.signals.map(s => [s.key, s]));

  test('returns the four signals in display order', () => {
    expect(result.signals.map(s => s.key)).toEqual(SIGNAL_KEYS);
    expect(SIGNAL_KEYS).toEqual(['barrier', 'clarity', 'tone', 'resilience']);
  });

  test('each signal is the rounded average of its RAW member scores', () => {
    expect(byKey.barrier.score).toBe(56);    // (48.94 + 63.45) / 2 = 56.195
    expect(byKey.clarity.score).toBe(78);    // (52.34 + 88.17 + 93.98) / 3 = 78.16
    expect(byKey.tone.score).toBe(72);       // (76.80 + 68.27 + 71.40) / 3 = 72.16
    expect(byKey.resilience.score).toBe(80); // (74.79 + 85.12) / 2 = 79.955
  });

  test('passes the member raw scores through for the Railway request', () => {
    expect(byKey.resilience.concerns).toEqual({ wrinkle: 74.79, firmness: 85.12 });
  });

  test('overall is the rounded raw "all" score; skin age and skin type pass through', () => {
    expect(result.overall).toBe(76);
    expect(result.skinAge).toBe(37);
    expect(result.skinType).toEqual({ whole: 'Combination', tZone: 'Oily', uZone: 'Normal' });
  });

  test('an older scan without firmness/age_spot averages only the members it has', () => {
    const old = { concerns: { wrinkle: { raw: 70 }, radiance: { raw: 60 }, redness: { raw: 80 } } };
    const signals = computeSignals(old).signals;
    expect(signals.find(s => s.key === 'resilience')).toMatchObject({ score: 70, concerns: { wrinkle: 70 } });
    expect(signals.find(s => s.key === 'tone').score).toBe(70);
  });

  test('a signal with no member scores is null, not 0', () => {
    const signals = computeSignals({ concerns: { moisture: { raw: 50 } } }).signals;
    expect(signals.find(s => s.key === 'clarity')).toMatchObject({ score: null, concerns: {} });
  });

  test('missing overall / skin age are null', () => {
    expect(computeSignals({ concerns: {} })).toMatchObject({ overall: null, skinAge: null, skinType: null });
  });

  test('no merged scan -> null', () => {
    expect(computeSignals(null)).toBeNull();
    expect(computeSignals(undefined)).toBeNull();
  });
});
