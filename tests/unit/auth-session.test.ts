// Covers: STEP-009, REQ-AUTH-004, REQ-AUTH-005
//
// Tests for session validation and transparent re-authentication.
// HTTP and Keychain are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/keychain.js", () => {
  const mockKeychain = {
    readCredentials: vi.fn(),
    storeCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
  };
  return {
    KeychainAdapter: vi.fn().mockImplementation(() => mockKeychain),
    tryCreateKeychain: vi.fn(() => mockKeychain),
  };
});

import { validateOrRefreshSession } from "../../src/auth/session.js";
import { KeychainAdapter } from "../../src/auth/keychain.js";

function makeHttpClient(sessionValid: boolean, reAuthSucceeds = true) {
  return {
    get: vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/my/")) {
        return {
          status: 200,
          url: sessionValid
            ? "https://moodle.example.com/my/"
            : "https://moodle.example.com/login/index.php",
          body: "",
          headers: {},
        };
      }
      // Login page fetch (for logintoken during re-auth)
      return {
        status: 200,
        url,
        body: '<input type="hidden" name="logintoken" value="faketoken">',
        headers: { "set-cookie": "MoodleSession=newsession; path=/" },
      };
    }),
    post: vi.fn().mockImplementation(async () => ({
      status: 200,
      url: reAuthSucceeds
        ? "https://moodle.example.com/my/"
        : "https://moodle.example.com/login/index.php",
      body: "",
      headers: {},
    })),
  };
}

describe("STEP-009: Session validation", () => {
  let keychainInstance: ReturnType<typeof vi.mocked<InstanceType<typeof KeychainAdapter>>>;

  beforeEach(() => {
    vi.clearAllMocks();
    keychainInstance = new (vi.mocked(KeychainAdapter))() as never;
  });

  // REQ-AUTH-004 — valid session: proceed immediately
  it("does not re-authenticate when the session is valid", async () => {
    const httpClient = makeHttpClient(true);
    vi.mocked(keychainInstance.readCredentials).mockResolvedValue(null);

    const cookie = await validateOrRefreshSession({ httpClient: httpClient as never, keychain: keychainInstance });

    expect(httpClient.post).not.toHaveBeenCalled();
    expect(typeof cookie).toBe("string");
  });

  // REQ-AUTH-005 — expired session + valid Keychain creds → silent re-auth
  it("re-authenticates silently when session is expired and Keychain creds exist", async () => {
    const httpClient = makeHttpClient(false, true);
    vi.mocked(keychainInstance.readCredentials).mockResolvedValue({
      username: "alice",
      password: "correctpass",
    });

    const warnings: string[] = [];
    const logger = { debug: vi.fn(), info: vi.fn(), warn: (msg: string) => warnings.push(msg), error: vi.fn() };

    await validateOrRefreshSession({ httpClient: httpClient as never, keychain: keychainInstance, logger });

    expect(httpClient.post).toHaveBeenCalled(); // re-auth happened
    expect(warnings.join(" ")).toContain("re-authenticating");
  });

  // REQ-AUTH-005 — re-auth failure after 3 attempts → exit 3
  it("throws with exitCode 3 after 3 consecutive re-auth failures", async () => {
    const httpClient = makeHttpClient(false, false); // re-auth always fails
    vi.mocked(keychainInstance.readCredentials).mockResolvedValue({
      username: "alice",
      password: "wrongpass",
    });

    await expect(
      validateOrRefreshSession({ httpClient: httpClient as never, keychain: keychainInstance, maxRetries: 3 })
    ).rejects.toMatchObject({ exitCode: 3, message: /Authentication failed after 3 attempts/ });
  });

  // REQ-AUTH-005 — expired session + no Keychain creds → fall back to interactive prompt
  it("invokes the interactive prompt fallback when no Keychain credentials exist", async () => {
    const httpClient = makeHttpClient(false, true);
    vi.mocked(keychainInstance.readCredentials).mockResolvedValue(null);
    const interactiveFallback = vi.fn().mockResolvedValue("MoodleSession=fresh; path=/");

    await validateOrRefreshSession({
      httpClient: httpClient as never,
      keychain: keychainInstance,
      interactivePromptFallback: interactiveFallback,
    });

    expect(interactiveFallback).toHaveBeenCalled();
  });

  // Bug fix: interactivePromptFallback must return the session cookie (not discard it)
  it("returns the cookie from interactivePromptFallback (not empty string)", async () => {
    const httpClient = makeHttpClient(false, true);
    vi.mocked(keychainInstance.readCredentials).mockResolvedValue(null);
    const interactiveFallback = vi.fn().mockResolvedValue("MoodleSession=newcookie; path=/");

    const cookie = await validateOrRefreshSession({
      httpClient: httpClient as never,
      keychain: keychainInstance,
      interactivePromptFallback: interactiveFallback,
    });

    expect(cookie).toBe("MoodleSession=newcookie; path=/");
  });
});
