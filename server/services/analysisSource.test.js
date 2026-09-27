const { analysisSourceFromBody, geminiExtrasFromBody } = require('../routes/analysis');

// The product routine, shelf audit, safety flags etc. relayed from the Railway response.
describe('geminiExtrasFromBody', () => {
  test('keeps object/array extras and nulls the missing ones', () => {
    const srProducts = { am: [{ step: 1, routine_category: 'cleanser', sr_product_name: 'Gentle Wash' }], pm: [] };
    expect(geminiExtrasFromBody({ srProducts, safetyFlags: ['retinoid caution'] })).toEqual({
      srProducts,
      shelfAnalysis: null,
      safetyFlags: ['retinoid caution'],
      checkInPrompts: null,
      eventPrep: null,
    });
  });

  test('strips embedded data: URLs and prototype keys', () => {
    const body = JSON.parse('{"shelfAnalysis":{"__proto__":{"x":1},"note":"ok","img":"data:image/png;base64,AAAA"}}');
    expect(geminiExtrasFromBody(body).shelfAnalysis).toEqual({ note: 'ok' });
  });

  test('drops bare scalars and tolerates a missing body', () => {
    expect(geminiExtrasFromBody({ srProducts: 'text', eventPrep: 5 }).srProducts).toBeNull();
    expect(geminiExtrasFromBody({ srProducts: 'text', eventPrep: 5 }).eventPrep).toBeNull();
    expect(geminiExtrasFromBody(undefined).srProducts).toBeNull();
  });
});

// SkinAnalysis.source tells a real Gemini result apart from the canned fallback.
// It is diagnostic metadata, so bad input degrades to null instead of failing the save.
describe('analysisSourceFromBody', () => {
  test('keeps a gemini result without a reason', () => {
    expect(analysisSourceFromBody({ source: 'gemini', fallbackReason: 'ignored' }))
      .toEqual({ source: 'gemini', fallbackReason: null });
  });

  test('keeps a fallback with its trimmed reason', () => {
    expect(analysisSourceFromBody({ source: 'fallback', fallbackReason: '  Railway API 404 ' }))
      .toEqual({ source: 'fallback', fallbackReason: 'Railway API 404' });
  });

  test('caps a long reason at 200 characters', () => {
    const { fallbackReason } = analysisSourceFromBody({ source: 'fallback', fallbackReason: 'x'.repeat(500) });
    expect(fallbackReason).toHaveLength(200);
  });

  test('stores unknown or missing sources as null (older clients)', () => {
    expect(analysisSourceFromBody({})).toEqual({ source: null, fallbackReason: null });
    expect(analysisSourceFromBody({ source: 'hacked' })).toEqual({ source: null, fallbackReason: null });
    expect(analysisSourceFromBody(undefined)).toEqual({ source: null, fallbackReason: null });
  });

  test('ignores a non-string reason', () => {
    expect(analysisSourceFromBody({ source: 'fallback', fallbackReason: { a: 1 } }))
      .toEqual({ source: 'fallback', fallbackReason: null });
  });
});
