jest.mock('./rateLimit');

const { consumeRateLimit } = require('./rateLimit');
const { enforceAnonymousScanBudget } = require('./anonymousScanBudget');

beforeEach(() => {
  jest.clearAllMocks();
});

test('consumes per-IP then global when both are within budget', async () => {
  consumeRateLimit.mockResolvedValue(true);

  await expect(enforceAnonymousScanBudget('iphash')).resolves.toBeUndefined();

  expect(consumeRateLimit).toHaveBeenNthCalledWith(1, 'scan_ip', 'iphash', expect.any(Number));
  expect(consumeRateLimit).toHaveBeenNthCalledWith(2, 'scan_global', 'all', expect.any(Number));
});

test('an IP over its own limit is rejected without touching the global counter', async () => {
  consumeRateLimit.mockResolvedValueOnce(false); // scan_ip denied

  await expect(enforceAnonymousScanBudget('iphash')).rejects.toMatchObject({ status: 429 });

  expect(consumeRateLimit).toHaveBeenCalledTimes(1);
  expect(consumeRateLimit).toHaveBeenCalledWith('scan_ip', 'iphash', expect.any(Number));
  expect(consumeRateLimit).not.toHaveBeenCalledWith('scan_global', 'all', expect.any(Number));
});

test('rejects with 429 when the global budget is exhausted', async () => {
  consumeRateLimit
    .mockResolvedValueOnce(true)   // scan_ip ok
    .mockResolvedValueOnce(false); // scan_global exhausted

  await expect(enforceAnonymousScanBudget('iphash')).rejects.toMatchObject({ status: 429 });
  expect(consumeRateLimit).toHaveBeenCalledTimes(2);
});

test('honors explicit limit overrides', async () => {
  consumeRateLimit.mockResolvedValue(true);

  await enforceAnonymousScanBudget('iphash', { perIpLimit: 7, globalLimit: 250 });

  expect(consumeRateLimit).toHaveBeenNthCalledWith(1, 'scan_ip', 'iphash', 7);
  expect(consumeRateLimit).toHaveBeenNthCalledWith(2, 'scan_global', 'all', 250);
});
