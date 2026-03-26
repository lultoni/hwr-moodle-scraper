// Covers: STEP-005, REQ-SEC-005, REQ-SEC-009
//
// Tests for request rate limiting and jitter. Uses vitest fake timers so
// no test actually waits in real time.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RateLimiter } from "../../src/http/rate-limiter.js";

describe("STEP-005: Rate limiter — concurrency", () => {
  // REQ-SEC-005
  it("allows at most 5 concurrent in-flight requests", async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxConcurrent: 5, delayMs: 0, jitterMs: 0 });
    let inFlight = 0;
    let maxSeen = 0;

    const tasks = Array.from({ length: 10 }, () =>
      limiter.schedule(async () => {
        inFlight++;
        maxSeen = Math.max(maxSeen, inFlight);
        await new Promise<void>((r) => setTimeout(r, 10));
        inFlight--;
      })
    );

    // Advance timers to let all tasks run
    await vi.runAllTimersAsync();
    await Promise.all(tasks);

    expect(maxSeen).toBeLessThanOrEqual(5);
    vi.useRealTimers();
  });
});

describe("STEP-005: Rate limiter — inter-request delay", () => {
  // REQ-SEC-005
  it("enforces at least 500 ms between consecutive requests", async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxConcurrent: 1, delayMs: 500, jitterMs: 0 });
    const timestamps: number[] = [];

    const tasks = [0, 1, 2].map(() =>
      limiter.schedule(async () => {
        timestamps.push(Date.now());
      })
    );

    await vi.runAllTimersAsync();
    await Promise.all(tasks);

    for (let i = 1; i < timestamps.length; i++) {
      expect((timestamps[i] ?? 0) - (timestamps[i - 1] ?? 0)).toBeGreaterThanOrEqual(500);
    }
    vi.useRealTimers();
  });
});

describe("STEP-005: Rate limiter — jitter", () => {
  // REQ-SEC-009
  it("applied delay is within [delayMs - jitterMs, delayMs + jitterMs]", async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxConcurrent: 1, delayMs: 500, jitterMs: 200 });
    const timestamps: number[] = [];

    const tasks = [0, 1].map(() =>
      limiter.schedule(async () => {
        timestamps.push(Date.now());
      })
    );

    await vi.runAllTimersAsync();
    await Promise.all(tasks);

    const gap = (timestamps[1] ?? 0) - (timestamps[0] ?? 0);
    expect(gap).toBeGreaterThanOrEqual(300); // 500 - 200
    expect(gap).toBeLessThanOrEqual(700);    // 500 + 200
    vi.useRealTimers();
  });
});

describe("STEP-005: Rate limiter — configuration", () => {
  it("respects a custom maxConcurrent of 1 (sequential execution)", async () => {
    vi.useFakeTimers();
    const order: number[] = [];
    const limiter = new RateLimiter({ maxConcurrent: 1, delayMs: 0, jitterMs: 0 });

    const tasks = [1, 2, 3].map((n) =>
      limiter.schedule(async () => {
        order.push(n);
      })
    );

    await vi.runAllTimersAsync();
    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3]);
    vi.useRealTimers();
  });
});
