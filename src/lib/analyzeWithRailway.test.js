import { mapToAppFormat } from './analyzeWithRailway';

jest.mock('./auth');

// Minimal Railway response in the shape mapToAppFormat reads. The real shape is owned by
// the Railway service and must be re-confirmed against a live response once it is back.
function railway({ eraId = 'glow_building', am, pm, srProducts } = {}) {
  return {
    era: {
      era: eraId ? { id: eraId, affirmation: 'I glow.' } : {},
      skin_analysis: { summary: 'Healthy barrier.', key_insights: [{ title: 'Hydration', body: 'Good' }] },
      routine: {
        am: am ?? [{ category: 'Cleanser', instruction: 'Lukewarm water' }],
        pm: pm ?? [{ category: 'Moisturizer', instruction: 'Pea-sized' }],
      },
      product_audit: {},
    },
    srProducts: srProducts ?? null,
  };
}

describe('mapToAppFormat', () => {
  test('maps a valid response and marks it as a real Gemini result', () => {
    const result = mapToAppFormat(railway(), {});
    expect(result.source).toBe('gemini');
    expect(result.eraId).toBe('glow_building');
    expect(result.routine.am).toEqual([{ name: 'Cleanser', description: 'Lukewarm water' }]);
    expect(result.keyInsights).toEqual(['Hydration: Good']);
  });

  test('carries srProducts on the analysis so it is saved with it', () => {
    const srProducts = { am: [{ step: 1, routine_category: 'cleanser' }], pm: [] };
    expect(mapToAppFormat(railway({ srProducts }), {}).srProducts).toBe(srProducts);
  });

  test('rejects a response with no era id (used to become an empty barrier_healing result)', () => {
    expect(() => mapToAppFormat(railway({ eraId: null }), {})).toThrow('no era id');
  });

  test('rejects a response with no routine steps anywhere', () => {
    expect(() => mapToAppFormat(railway({ am: [], pm: [] }), {})).toThrow('no routine steps');
  });

  test('accepts an empty generic routine when the product routine has steps', () => {
    const srProducts = { am: [{ step: 1, routine_category: 'cleanser' }], pm: [] };
    expect(() => mapToAppFormat(railway({ am: [], pm: [], srProducts }), {})).not.toThrow();
  });

  test('rejects a completely unexpected body', () => {
    expect(() => mapToAppFormat({ error: 'quota exceeded' }, {})).toThrow('Invalid analysis response');
    expect(() => mapToAppFormat(null, {})).toThrow('Invalid analysis response');
  });
});
