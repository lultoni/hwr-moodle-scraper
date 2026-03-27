// REQ-ERR-001 through REQ-ERR-007
export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  /** If provided, only retry when this returns true for the thrown error. */
  shouldRetry?: (err: unknown) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  let lastError: Error = new Error("Unknown error");
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      // If shouldRetry is set and returns false, rethrow immediately
      if (opts.shouldRetry && !opts.shouldRetry(err)) throw err;
      if (attempt < opts.maxAttempts) {
        const delay = opts.baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
