const { enforceAnalysisBudget } = require('./analysisBudget');

test('uses a hashed per-IP bucket before the shared paid-analysis bucket', async () => {
  const consume = jest.fn().mockResolvedValue(true);
  await expect(enforceAnalysisBudget('203.0.113.8', { secret: 'unit-test-key', consume, perIpLimit: 3, globalLimit: 100 }))
    .resolves.toBe(true);
  expect(consume).toHaveBeenNthCalledWith(1, 'analysis_ip', expect.any(String), 3);
  expect(consume).toHaveBeenNthCalledWith(2, 'analysis_global', 'all', 100);
  expect(consume.mock.calls[0][1]).not.toContain('203.0.113.8');
});

test('does not consume the global budget after the per-IP cap is reached', async () => {
  const consume = jest.fn().mockResolvedValue(false);
  await expect(enforceAnalysisBudget('203.0.113.8', { secret: 'unit-test-key', consume })).resolves.toBe(false);
  expect(consume).toHaveBeenCalledTimes(1);
});

test('fails closed when no IP-hash secret is configured', async () => {
  await expect(enforceAnalysisBudget('203.0.113.8', { secret: '', consume: jest.fn() }))
    .rejects.toThrow('Analysis budget is unavailable');
});
