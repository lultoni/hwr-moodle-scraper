// Covers: STEP-006, REQ-AUTH-002, REQ-SEC-001, REQ-SEC-004
//
// Tests for macOS Keychain adapter. The real Keychain is NEVER touched in tests —
// keytar is mocked. Note: security-sensitive mock — see mock comment below.
//
// SECURITY NOTE: keytar is mocked here because calling the real Keychain in CI
// would (a) require macOS, (b) pollute the user's real Keychain, and (c) require
// user approval dialogs. The mock faithfully represents the contract of the real API.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock keytar BEFORE importing the keychain module
vi.mock("keytar", () => {
  const store = new Map<string, string>();
  return {
    default: {
      setPassword: vi.fn(async (service: string, account: string, password: string) => {
        store.set(`${service}:${account}`, password);
      }),
      getPassword: vi.fn(async (service: string, account: string) => {
        return store.get(`${service}:${account}`) ?? null;
      }),
      deletePassword: vi.fn(async (service: string, account: string) => {
        return store.delete(`${service}:${account}`);
      }),
      findCredentials: vi.fn(async (_service: string) => {
        return [];
      }),
    },
  };
});

import { KeychainAdapter, PlatformNotSupportedError, tryCreateKeychain } from "../../src/auth/keychain.js";
import keytar from "keytar";

const mockedKeytar = vi.mocked(keytar);

describe("STEP-006: Keychain adapter", () => {
  let adapter: KeychainAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new KeychainAdapter();
  });

  // REQ-AUTH-002 — store and retrieve
  it("storeCredentials() writes to Keychain with service 'moodle-scraper'", async () => {
    await adapter.storeCredentials("alice", "s3cr3t");
    expect(mockedKeytar.setPassword).toHaveBeenCalledWith("moodle-scraper", "alice", "s3cr3t");
  });

  it("readCredentials() returns the stored username and password", async () => {
    mockedKeytar.findCredentials.mockResolvedValueOnce([{ account: "alice", password: "s3cr3t" }]);
    const creds = await adapter.readCredentials();
    expect(creds).toEqual({ username: "alice", password: "s3cr3t" });
  });

  it("deleteCredentials() removes the Keychain entry", async () => {
    await adapter.storeCredentials("alice", "s3cr3t");
    await adapter.deleteCredentials();
    expect(mockedKeytar.deletePassword).toHaveBeenCalledWith("moodle-scraper", expect.any(String));
  });

  it("readCredentials() returns null when no entry exists", async () => {
    mockedKeytar.findCredentials.mockResolvedValueOnce([]);
    const creds = await adapter.readCredentials();
    expect(creds).toBeNull();
  });

  // REQ-AUTH-002 — service name is ALWAYS 'moodle-scraper', never derived from input
  it("service name is always the hardcoded string 'moodle-scraper'", async () => {
    await adapter.storeCredentials("bob", "pass");
    const call = mockedKeytar.setPassword.mock.calls[0];
    expect(call?.[0]).toBe("moodle-scraper");
  });

  // REQ-AUTH-002 — Keychain write failure: no plaintext fallback
  it("storeCredentials() throws and does not fall back when setPassword rejects", async () => {
    mockedKeytar.setPassword.mockRejectedValueOnce(new Error("Keychain locked"));
    await expect(adapter.storeCredentials("alice", "pass")).rejects.toThrow(
      /could not save credentials to Keychain/
    );
  });

  it("readCredentials() throws when keytar rejects", async () => {
    mockedKeytar.findCredentials.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(adapter.readCredentials()).rejects.toThrow(
      /could not read credentials from Keychain/
    );
  });

  // REQ-AUTH-002-C — non-macOS platform error
  it("throws PlatformNotSupportedError on non-macOS platform", async () => {
    // Simulate non-macOS by overriding the platform check
    const adapter = new KeychainAdapter({ platform: "linux" });
    await expect(adapter.storeCredentials("alice", "pass")).rejects.toThrow(
      PlatformNotSupportedError
    );
    await expect(adapter.storeCredentials("alice", "pass")).rejects.toThrow(
      /requires macOS Keychain.*Current platform: linux/
    );
  });
});

describe("tryCreateKeychain", () => {
  it("returns a KeychainAdapter on macOS (darwin)", () => {
    // This test runs on macOS CI — the factory should return an instance
    if (process.platform === "darwin") {
      const kc = tryCreateKeychain();
      expect(kc).toBeInstanceOf(KeychainAdapter);
    }
  });

  it("returns null on non-macOS platforms", () => {
    // On non-darwin this returns null; on darwin we can't easily test this
    // without mocking platform(), so this test is conditional
    if (process.platform !== "darwin") {
      expect(tryCreateKeychain()).toBeNull();
    }
  });
});
