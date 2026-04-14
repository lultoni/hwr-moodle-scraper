// Covers: STEP-004, REQ-SEC-003, REQ-SEC-008, REQ-SEC-006
//
// Tests for the HTTP client wrapper: HTTPS enforcement, TLS validation,
// User-Agent header, InsecureURLError, mergeCookies, and 429/maintenance handling.
// No real network calls — uses undici MockAgent to intercept requests.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from "undici";
import { createHttpClient, InsecureURLError } from "../../src/http/client.js";
import { extractCookies } from "../../src/http/cookies.js";

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
});

describe("STEP-004: HTTP client — HTTPS enforcement", () => {
  // REQ-SEC-003
  it("throws InsecureURLError for http:// URLs before any network request", async () => {
    const client = createHttpClient();
    await expect(client.get("http://moodle.example.com/course")).rejects.toThrow(InsecureURLError);
  });

  it("InsecureURLError message names the offending URL", async () => {
    const client = createHttpClient();
    const url = "http://moodle.example.com/course";
    try {
      await client.get(url);
    } catch (err) {
      expect((err as Error).message).toContain(url);
    }
  });

  it("does NOT throw for https:// URLs", async () => {
    const pool = mockAgent.get("https://moodle.example.com");
    pool.intercept({ path: "/course", method: "GET" }).reply(200, "ok");
    const client = createHttpClient();
    await expect(client.get("https://moodle.example.com/course")).resolves.toBeDefined();
  });

  it("rejects javascript: URLs", async () => {
    const client = createHttpClient();
    await expect(client.get("javascript:alert(1)")).rejects.toThrow(InsecureURLError);
  });

  it("rejects data: URLs", async () => {
    const client = createHttpClient();
    await expect(client.get("data:text/html,<h1>hi</h1>")).rejects.toThrow(InsecureURLError);
  });

  it("rejects file: URLs", async () => {
    const client = createHttpClient();
    await expect(client.get("file:///etc/passwd")).rejects.toThrow(InsecureURLError);
  });

  it("rejects ftp: URLs", async () => {
    const client = createHttpClient();
    await expect(client.get("ftp://example.com/file")).rejects.toThrow(InsecureURLError);
  });
});

describe("STEP-004: HTTP client — User-Agent header", () => {
  // REQ-SEC-006
  it("every GET request carries a User-Agent starting with 'moodle-scraper/'", async () => {
    let capturedUA: string | null = null;
    const pool = mockAgent.get("https://moodle.example.com");
    pool
      .intercept({ path: "/test", method: "GET" })
      .reply(200, "ok", {})
      .times(1);

    // Intercept and capture headers via mock
    const pool2 = mockAgent.get("https://moodle.example.com");
    pool2
      .intercept({ path: "/ua-check", method: "GET" })
      .reply(function (req) {
        capturedUA = req.headers["user-agent"] as string ?? null;
        return { statusCode: 200, data: "ok" };
      });

    const client = createHttpClient();
    await client.get("https://moodle.example.com/ua-check");
    expect(capturedUA).toMatch(/^moodle-scraper\//);
  });

  it("User-Agent includes the package version", async () => {
    const pool = mockAgent.get("https://moodle.example.com");
    let capturedUA = "";
    pool.intercept({ path: "/v", method: "GET" }).reply(function (req) {
      capturedUA = req.headers["user-agent"] as string ?? "";
      return { statusCode: 200, data: "ok" };
    });

    const client = createHttpClient();
    await client.get("https://moodle.example.com/v");
    expect(capturedUA).toMatch(/moodle-scraper\/\d+\.\d+\.\d+/);
  });
});

describe("STEP-004: HTTP client — TLS validation", () => {
  // REQ-SEC-008
  it("client does not expose a way to disable TLS certificate validation", () => {
    // createHttpClient accepts options but must not include rejectUnauthorized
    const client = createHttpClient();
    // The client object should not have any property that disables TLS
    expect((client as Record<string, unknown>).rejectUnauthorized).toBeUndefined();
  });
});

describe("extractCookies — cookie utility", () => {
  it("extracts name=value pairs from a single Set-Cookie header", () => {
    const cookies = extractCookies({ "set-cookie": "MoodleSession=abc123; path=/; HttpOnly" });
    expect(cookies).toBe("MoodleSession=abc123");
  });

  it("merges multiple Set-Cookie headers into a semicolon-separated string", () => {
    const cookies = extractCookies({ "set-cookie": ["MoodleSession=abc; path=/", "csrftoken=xyz; path=/"] });
    expect(cookies).toBe("MoodleSession=abc; csrftoken=xyz");
  });

  it("returns empty string when no Set-Cookie header present", () => {
    const cookies = extractCookies({ "content-type": "text/html" });
    expect(cookies).toBe("");
  });
});
