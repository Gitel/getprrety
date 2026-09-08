// A 4xx is deterministic: the same request gets the same rejection every time, so
// retrying only burns the user's time and triples the server's load for nothing.
// 408 (timeout) and 429 (rate limited) are the exceptions — those genuinely clear.
// An error with no status is a network/abort failure and is always worth another go.
export function isRetryable(err) {
  const status = err?.status;
  if (typeof status !== 'number') return true;
  if (status === 408 || status === 429) return true;
  return status < 400 || status >= 500;
}

// Retry an async operation with exponential backoff. Rethrows the error that ended
// the run — whether the budget ran out or the failure was one retrying can't fix —
// so the caller can decide what a hard failure means.
export async function withRetry(fn, { attempts = 3, baseMs = 600, shouldRetry = isRetryable } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts - 1 || !shouldRetry(err)) throw err;
      await new Promise(resolve => setTimeout(resolve, baseMs * 2 ** i));
    }
  }
}
