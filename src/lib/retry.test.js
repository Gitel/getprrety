import { withRetry, isRetryable } from './retry';

const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });

test('returns the value on first success', async () => {
  await expect(withRetry(async () => 'ok')).resolves.toBe('ok');
});

test('retries a 500 and returns the eventual success', async () => {
  let calls = 0;
  const fn = jest.fn(async () => {
    calls += 1;
    if (calls < 3) throw httpError(500);
    return 'ok';
  });
  await expect(withRetry(fn, { baseMs: 0 })).resolves.toBe('ok');
  expect(fn).toHaveBeenCalledTimes(3);
});

test('gives up after the attempt budget and rethrows the last error', async () => {
  const fn = jest.fn(async () => { throw httpError(503); });
  await expect(withRetry(fn, { attempts: 3, baseMs: 0 })).rejects.toMatchObject({ status: 503 });
  expect(fn).toHaveBeenCalledTimes(3);
});

test('does not retry a 400 — the same request is rejected the same way every time', async () => {
  const fn = jest.fn(async () => { throw httpError(400); });
  await expect(withRetry(fn, { baseMs: 0 })).rejects.toMatchObject({ status: 400 });
  expect(fn).toHaveBeenCalledTimes(1);
});

test('does not retry a 403', async () => {
  const fn = jest.fn(async () => { throw httpError(403); });
  await expect(withRetry(fn, { baseMs: 0 })).rejects.toMatchObject({ status: 403 });
  expect(fn).toHaveBeenCalledTimes(1);
});

test('retries 408 and 429 — those can clear on their own', async () => {
  for (const status of [408, 429]) {
    const fn = jest.fn(async () => { throw httpError(status); });
    await expect(withRetry(fn, { attempts: 2, baseMs: 0 })).rejects.toMatchObject({ status });
    expect(fn).toHaveBeenCalledTimes(2);
  }
});

test('retries a statusless error — a dropped socket is worth another go', async () => {
  const fn = jest.fn(async () => { throw new Error('Network request failed'); });
  await expect(withRetry(fn, { attempts: 2, baseMs: 0 })).rejects.toThrow('Network request failed');
  expect(fn).toHaveBeenCalledTimes(2);
});

test('isRetryable classifies by status', () => {
  expect(isRetryable(httpError(500))).toBe(true);
  expect(isRetryable(httpError(400))).toBe(false);
  expect(isRetryable(httpError(429))).toBe(true);
  expect(isRetryable(new Error('offline'))).toBe(true);
});
