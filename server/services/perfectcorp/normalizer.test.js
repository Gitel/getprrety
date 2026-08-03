const { normalize } = require('./normalizer');
const sampleOutput = require('./__fixtures__/sampleTaskOutput');

describe('normalize', () => {
  const capturedAt = new Date('2026-07-27T19:07:51Z');
  const result = normalize({ output: sampleOutput, angle: 'front', taskId: 'task-1', capturedAt });

  test('routes scored concerns by type, not array position', () => {
    expect(result.concerns.acne.raw).toBeCloseTo(93.98);
    expect(result.concerns.acne.ui).toBe(91);
    expect(result.concerns.moisture.raw).toBeCloseTo(48.94);
    expect(Object.keys(result.concerns).sort()).toEqual(
      ['acne', 'moisture', 'oiliness', 'pore', 'radiance', 'redness', 'texture', 'wrinkle'].sort()
    );
  });

  test('routes skin_type by region, not by array position', () => {
    expect(result.skinType).toEqual({ whole: 'Combination', tZone: 'Oily', uZone: 'Normal' });
  });

  test('routes the aggregate "all" entry using `score`, not `ui_score`/`raw_score`', () => {
    expect(result.overall).toEqual({ raw: 75.93, ui: 76 });
  });

  test('routes skin_age separately from the aggregate score', () => {
    expect(result.skinAge).toBe(37);
  });

  test('routes resize_image as the normalized source image, with no scores', () => {
    expect(result.sourceImageUrl).toBe('https://cdn.example/resized.jpg');
  });

  test('ignores unknown types without throwing', () => {
    expect(() => normalize({ output: sampleOutput, angle: 'front' })).not.toThrow();
    expect(result.concerns.some_future_concern).toBeUndefined();
  });

  test('computes severity per the inverted band scale for every concern', () => {
    expect(result.concerns.acne.severity).toBe(0); // strong (raw >= 80)
    expect(result.concerns.moisture.severity).toBe(3); // needsWork (raw in [35,50))
  });

  test('stamps bandsVersion for reproducibility', () => {
    expect(result.bandsVersion).toBe('v1');
  });
});
