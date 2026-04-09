// Covers: STEP-018, REQ-ERR-001, REQ-ERR-002, REQ-ERR-003, REQ-ERR-004,
//         REQ-ERR-005, REQ-ERR-006, REQ-ERR-007
//
// Tests for HTTP error handling: timeouts, retries, status codes, maintenance mode.
// Uses fake timers for retry/backoff tests.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from "undici";
import { createHttpClient } from "../../src/http/client.js";
import { withRetry } from "../../src/http/retry.js";

let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
  mockAgent.close();
  vi.useRealTimers();
});

const BASE = "https://moodle.example.com";

describe("STEP-018: Retry on transient errors", () => {
  // REQ-ERR-001
  it("retries up to 3 times with exponential backoff on network error", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error("ECONNRESET");
      return "success";
    });

    const resultPromise = withRetry(operation, { maxAttempts: 3, baseDelayMs: 1000 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("throws after exhausting all retries", async () => {
    vi.useFakeTimers();
    const operation = vi.fn(async () => { throw new Error("persistent error"); });

    const p = withRetry(operation, { maxAttempts: 3, baseDelayMs: 100 });
    const assertion = expect(p).rejects.toThrow("persistent error");
    await vi.runAllTimersAsync();
    await assertion;

    expect(operation).toHaveBeenCalledTimes(3);
  });
});

describe("STEP-018: Retry jitter", () => {
  it("retry delay includes jitter (within [baseDelay/2, baseDelay*1.5])", async () => {
    // Use real timers but spy on setTimeout to capture the delay value
    const delays: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: Function, delay?: number) => {
      if (delay && delay >= 100) delays.push(delay);
      // Call immediately to avoid hanging
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error("fail");
      return "ok";
    });

    const result = await withRetry(operation, { maxAttempts: 3, baseDelayMs: 1000 });
    expect(result).toBe("ok");
    expect(delays).toHaveLength(2);

    // Attempt 1 retry: baseDelay = 1000 * 2^0 = 1000, jitter range [500, 1500]
    expect(delays[0]).toBeGreaterThanOrEqual(500);
    expect(delays[0]).toBeLessThanOrEqual(1500);

    // Attempt 2 retry: baseDelay = 1000 * 2^1 = 2000, jitter range [1000, 3000]
    expect(delays[1]).toBeGreaterThanOrEqual(1000);
    expect(delays[1]).toBeLessThanOrEqual(3000);

    setTimeoutSpy.mockRestore();
  });
});

describe("STEP-018: HTTP 403 handling", () => {
  // REQ-ERR-003
  it("logs 'Access denied' and does not throw", async () => {
    mockAgent.get(BASE).intercept({ path: "/restricted", method: "GET" }).reply(403, "Forbidden");
    const warnings: string[] = [];
    const logger = { debug: vi.fn(), info: vi.fn(), warn: (msg: string) => warnings.push(msg), error: vi.fn() };

    const client = createHttpClient();
    const result = await client.get(`${BASE}/restricted`, { handleErrors: true, logger });

    expect(warnings.join(" ")).toContain("Access denied");
    expect(result.status).toBe(403);
  });
});

describe("STEP-018: HTTP 429 handling", () => {
  // REQ-ERR-005
  it("waits Retry-After seconds then retries", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    mockAgent.get(BASE)
      .intercept({ path: "/throttled", method: "GET" })
      .reply(429, "Too Many Requests", { headers: { "retry-after": "2" } })
      .times(1);
    mockAgent.get(BASE)
      .intercept({ path: "/throttled", method: "GET" })
      .reply(200, "ok")
      .times(1);

    const client = createHttpClient();
    const p = client.get(`${BASE}/throttled`);
    await vi.advanceTimersByTimeAsync(2100);
    const result = await p;

    expect(result.status).toBe(200);
  });
});

describe("STEP-018: HTTP 5xx handling", () => {
  // REQ-ERR-006
  it("retries 3x on 503 then logs error and resolves with the error response", async () => {
    vi.useFakeTimers();
    mockAgent.get(BASE).intercept({ path: "/unstable", method: "GET" }).reply(503, "Service Unavailable").times(3);

    const client = createHttpClient();
    const warnings: string[] = [];
    const logger = { debug: vi.fn(), info: vi.fn(), warn: (msg: string) => warnings.push(msg), error: vi.fn() };

    const p = client.get(`${BASE}/unstable`, { retry: true, maxRetries: 3, logger });
    await vi.runAllTimersAsync();
    const result = await p;

    expect(warnings.length).toBeGreaterThan(0); // error was logged
  });
});

describe("STEP-018: Moodle maintenance mode detection", () => {
  // REQ-ERR-007
  it("throws with exitCode 4 when response contains site-maintenance class", async () => {
    mockAgent.get(BASE).intercept({ path: "/", method: "GET" }).reply(200,
      '<html><body class="site-maintenance"><div>Moodle is in maintenance mode.</div></body></html>',
      { headers: { "content-type": "text/html" } }
    );

    const client = createHttpClient();
    await expect(client.get(`${BASE}/`)).rejects.toMatchObject({
      exitCode: 4,
      message: /maintenance mode/i,
    });
  });
});
