// Retry an async operation with exponential backoff. Rethrows the last error once
// every attempt is exhausted so the caller can decide what a hard failure means.
export async function withRetry(fn, { attempts = 3, baseMs = 600 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, baseMs * 2 ** i));
      }
    }
  }
  throw lastErr;
}
