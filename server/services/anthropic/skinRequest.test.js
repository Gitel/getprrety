'use strict';

const { prepareSkinRequest } = require('./skinRequest');

const product = { _id: '507f1f77bcf86cd799439011', name: 'Calm Cream', category: 'face_creams', use: 'home',
  pregnancy: 'not_stated', archived: false, keyActives: [], strengths: [], suitableFor: [], ingredients: '' };

test('requires catalogue-first selection and generic-only guidance when no suitable product fits', () => {
  const request = prepareSkinRequest({
    quiz: { allergies: ['none'], irritants: ['none'], pregnant_or_ttc: 'no' },
    catalogue: [product], guidance: 'Keep it concise.',
  });
  expect(request.system).toContain('For every product need, first assess the supplied eligible catalogue');
  expect(request.system).toContain('Only when no suitable eligible catalogue product fits');
  expect(request.system).toContain('Do not recommend outside brands or market products');
  expect(request.system).toContain('Do not leave srProducts wholly empty');
  expect(request.system).toContain('no verified numeric SPF field');
  expect(request.messages[0].content[0].text).toContain(product._id);
});

test('uses compact schema and requires null evidence fields when their context is absent', () => {
  const request = prepareSkinRequest({ quiz: {}, language: 'en', images: [], catalogue: [product] });

  expect(request.schema.required).toEqual(['era', 'srProducts', 'shelfAnalysis']);
  expect(request.wireSchema.properties.shelfAnalysis).toEqual({ type: 'null' });
  expect(request.wireSchema.properties.era.properties.event_prep).toEqual({ type: 'null' });
  expect(request.system).toContain('Compact response contract');
  expect(request.messages.length).toBeGreaterThan(0);
});

test('permits shelf analysis with a shelf photo while still pruning absent event preparation', () => {
  const request = prepareSkinRequest({ quiz: { event_type: 'none' }, language: 'he',
    images: [{ angle: 'shelf', mediaType: 'image/png', base64: 'encoded' }], catalogue: [] });

  expect(request.wireSchema.properties.shelfAnalysis.type).not.toBe('null');
  expect(request.wireSchema.properties.era.properties.event_prep).toEqual({ type: 'null' });
  expect(request.wireSchema.properties.srProducts).toEqual({ type: 'null' });
});

// The editable guidance goes between the locked rules and the compact-contract rules.
test('custom guidance is appended under the Clinic guidance heading before the compact rules', () => {
  const request = prepareSkinRequest({ quiz: {}, language: 'en', images: [], catalogue: [], guidance: 'Use a warm tone.' });
  expect(request.system).toContain('\n\nClinic guidance:\nUse a warm tone.\n\nCompact response contract');
  expect(request.system).not.toContain('You are producing a cautious');
});

test('empty guidance leaves out the heading entirely', () => {
  const request = prepareSkinRequest({ quiz: {}, language: 'en', images: [], catalogue: [], guidance: '' });
  expect(request.system).not.toContain('Clinic guidance:');
  expect(request.system).toContain('Compact response contract');
});

test.each([
  [false, false, false], [false, false, true], [false, true, false], [false, true, true],
  [true, false, false], [true, false, true], [true, true, false], [true, true, true],
])('keeps evidence pruning with shelf=%s, event=%s, catalogue=%s', (shelf, event, catalogue) => {
  const request = prepareSkinRequest({
    quiz: { allergies: ['none'], irritants: ['none'], pregnant_or_ttc: 'no', event_type: event ? 'wedding' : 'none' },
    images: shelf ? [{ angle: 'shelf', mediaType: 'image/png', base64: 'encoded' }] : [],
    catalogue: catalogue ? [product] : [],
  });
  expect(request.wireSchema.properties.shelfAnalysis.type).toBe(shelf ? 'object' : 'null');
  expect(request.wireSchema.properties.era.properties.event_prep.type).toBe(event ? 'object' : 'null');
  expect(request.wireSchema.properties.srProducts.type).toBe(catalogue ? 'object' : 'null');
  expect(request.wireSchema.properties.era.properties.product_audit.properties.most_urgent_gap.type).toBe('string');
  // This is a wire-only simplification: saved/API null semantics remain unchanged.
  expect(request.schema.properties.srProducts.anyOf).toBeDefined();
});
