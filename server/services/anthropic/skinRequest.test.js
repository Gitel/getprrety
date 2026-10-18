'use strict';

const { prepareSkinRequest } = require('./skinRequest');

const product = { _id: '507f1f77bcf86cd799439011', name: 'Calm Cream', category: 'face_creams', use: 'home',
  pregnancy: 'not_stated', archived: false, keyActives: [], strengths: [], suitableFor: [], ingredients: '' };

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
