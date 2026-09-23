const { analysisSourceFromBody } = require('../routes/analysis');

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
