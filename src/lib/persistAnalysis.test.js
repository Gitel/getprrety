// persistAnalysis is the single writer for POST /api/analysis. These tests pin down that
// the SR Ritual and shelf analysis are part of that payload (they used to be dropped,
// which is why the Profile screen lost them on every relaunch).
jest.mock('./api', () => ({ api: { post: jest.fn(async () => ({})) } }));
jest.mock('./uploadImage', () => ({ uploadAll: jest.fn(async () => []) }));
jest.mock('./skinScan', () => ({ claimScan: jest.fn(async () => false) }));
jest.mock('./retry', () => ({ withRetry: fn => fn() }));

import { api } from './api';
import { persistAnalysis } from './persistAnalysis';

const analysis = {
  era: { id: 'glow_building' },
  skinAnalysis: 'Summary',
  keyInsights: [],
  productAudit: {},
  routine: { am: [], pm: [] },
  affirmation: 'I glow',
};

beforeEach(() => api.post.mockClear());

test('sends srProducts and shelfAnalysis with the analysis', async () => {
  const srProducts = { bundle_note: 'Note', am: [], pm: [] };
  const shelfAnalysis = { identified_products: [{ product_name: 'Cleanser' }] };
  // Both travel on the analysis object itself (see analyzeWithRailway.js mapToAppFormat).
  await persistAnalysis({ analysis: { ...analysis, srProducts, shelfAnalysis }, answers: {} });
  const [path, body] = api.post.mock.calls[0];
  expect(path).toBe('/api/analysis');
  expect(body.srProducts).toBe(srProducts);
  expect(body.shelfAnalysis).toBe(shelfAnalysis);
  expect(body.eraId).toBe('glow_building');
});

test('sends null for both when the analysis service returned none', async () => {
  await persistAnalysis({ analysis, answers: {} });
  const [, body] = api.post.mock.calls[0];
  expect(body.srProducts).toBeNull();
  expect(body.shelfAnalysis).toBeNull();
});

test('resolves to the analysis the server saved (with its _id)', async () => {
  api.post.mockResolvedValueOnce({ analysis: { _id: 'saved-1', eraId: 'glow_building' } });
  await expect(persistAnalysis({ analysis, answers: {} })).resolves.toEqual({ _id: 'saved-1', eraId: 'glow_building' });
  api.post.mockResolvedValueOnce({});
  await expect(persistAnalysis({ analysis, answers: {} })).resolves.toBeNull();
});

describe('withSavedId', () => {
  const { withSavedId } = require('./persistAnalysis');
  test('adds the saved _id to an in-memory analysis that has none', () => {
    expect(withSavedId({ eraId: 'x' }, { _id: 's1' })).toEqual({ eraId: 'x', _id: 's1' });
  });
  test('never overwrites an existing _id, and ignores missing inputs', () => {
    const fromServer = { _id: 'old' };
    expect(withSavedId(fromServer, { _id: 's1' })).toBe(fromServer);
    expect(withSavedId(null, { _id: 's1' })).toBeNull();
    const current = { eraId: 'x' };
    expect(withSavedId(current, null)).toBe(current);
  });
});
