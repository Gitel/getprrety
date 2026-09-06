import { withRetry } from './retry';

test('returns the value on first success', async () => {
  await expect(withRetry(async () => 'ok')).resolves.toBe('ok');
});
