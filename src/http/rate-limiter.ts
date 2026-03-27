// REQ-SEC-005, REQ-SEC-009
export interface RateLimiterOptions {
  maxConcurrent: number;
  delayMs: number;
  jitterMs: number;
}

export class RateLimiter {
  private readonly maxConcurrent: number;
  private readonly delayMs: number;
  private readonly jitterMs: number;
  private inFlight = 0;
  private queue: Array<() => void> = [];

  constructor(opts: RateLimiterOptions) {
    this.maxConcurrent = opts.maxConcurrent;
    this.delayMs = opts.delayMs;
    this.jitterMs = opts.jitterMs;
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.inFlight++;
        const jitter = this.jitterMs > 0
          ? (Math.random() - 0.5) * 2 * this.jitterMs
          : 0;
        const delay = Math.max(0, this.delayMs + jitter);

        setTimeout(async () => {
          try {
            resolve(await fn());
          } catch (err) {
            reject(err);
          } finally {
            this.inFlight--;
            this.tryDispatch();
          }
        }, delay);
      };

      this.queue.push(run);
      this.tryDispatch();
    });
  }

  private tryDispatch(): void {
    while (this.queue.length > 0 && this.inFlight < this.maxConcurrent) {
      const run = this.queue.shift()!;
      run();
    }
  }
}
