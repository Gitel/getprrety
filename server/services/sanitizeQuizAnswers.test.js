const { sanitizeQuizAnswers } = require('./sanitizeQuizAnswers');

describe('sanitizeQuizAnswers', () => {
  test('removes photos and capability tokens at any nesting level', () => {
    const clean = sanitizeQuizAnswers({
      name: 'Ada',
      front: 'data:image/jpeg;base64,abc',
      skinScanToken: 'secret',
      nested: { left: 'data:image/png;base64,abc', safe: 'yes' },
      list: [{ shelf_photos: ['data:image/jpeg;base64,abc'], value: 2 }],
    });

    expect(clean).toEqual({ name: 'Ada', nested: { safe: 'yes' }, list: [{ value: 2 }] });
  });

  test('drops embedded data URLs and oversized strings', () => {
    const clean = sanitizeQuizAnswers({
      safe: 'normal answer',
      nestedData: { payload: 'data:image/jpeg;base64,abc' },
      oversized: 'x'.repeat(5001),
    });

    expect(clean).toEqual({ safe: 'normal answer', nestedData: {} });
  });

  test('returns an empty object for invalid roots and bounds arrays', () => {
    expect(sanitizeQuizAnswers(null)).toEqual({});
    expect(sanitizeQuizAnswers(['not', 'an', 'object'])).toEqual({});
    expect(sanitizeQuizAnswers({ values: Array.from({ length: 150 }, (_, i) => i) }).values).toHaveLength(100);
  });
});
