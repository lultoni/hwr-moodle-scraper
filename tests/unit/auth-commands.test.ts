// Covers: STEP-010, REQ-AUTH-007, REQ-AUTH-008, REQ-CLI-003, REQ-CLI-004, REQ-CLI-005
//
// Tests for auth set / auth clear / auth status commands.
// Keychain and session are mocked.

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

vi.mock("../../src/auth/session.js", () => ({
  validateOrRefreshSession: vi.fn(),
  deleteSessionFile: vi.fn(),
}));

import { runAuthSet, runAuthClear, runAuthStatus } from "../../src/commands/auth.js";
import { KeychainAdapter } from "../../src/auth/keychain.js";
import { deleteSessionFile } from "../../src/auth/session.js";

describe("STEP-010: auth clear", () => {
  let keychainInstance: ReturnType<InstanceType<typeof KeychainAdapter> extends infer T ? () => T : never>;

  beforeEach(() => {
    vi.clearAllMocks();
    keychainInstance = new (vi.mocked(KeychainAdapter))() as never;
  });

  // REQ-AUTH-008
  it("removes Keychain entry and deletes session.json, prints confirmation", async () => {
    vi.mocked(keychainInstance.readCredentials).mockResolvedValue({
      username: "alice",
      password: "pass",
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runAuthClear({ keychain: keychainInstance as never, force: true });

    expect(keychainInstance.deleteCredentials).toHaveBeenCalled();
    expect(vi.mocked(deleteSessionFile)).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Credentials and session cleared.");
    stdoutSpy.mockRestore();
  });

  it("prints 'No credentials stored.' when nothing exists", async () => {
    vi.mocked(keychainInstance.readCredentials).mockResolvedValue(null);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runAuthClear({ keychain: keychainInstance as never, force: true });

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("No credentials stored.");
    stdoutSpy.mockRestore();
  });
});

describe("STEP-010: auth status", () => {
  // REQ-CLI-005
  it("prints 'Credentials: stored (username: alice)' and session info when creds exist", async () => {
    const keychainInstance = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychainInstance.readCredentials).mockResolvedValue({
      username: "alice",
      password: "s3cr3t",
    });
    const { validateOrRefreshSession } = await import("../../src/auth/session.js");
    vi.mocked(validateOrRefreshSession).mockResolvedValue(undefined);

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runAuthStatus({ keychain: keychainInstance });

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Credentials: stored");
    expect(output).toContain("alice");
    expect(output).not.toContain("s3cr3t"); // password must never be printed
    stdoutSpy.mockRestore();
  });

  it("prints 'Credentials: not stored' when no Keychain entry exists", async () => {
    const keychainInstance = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychainInstance.readCredentials).mockResolvedValue(null);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runAuthStatus({ keychain: keychainInstance });

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Credentials: not stored");
    stdoutSpy.mockRestore();
  });

  // REQ-CLI-005 — password is never printed
  it("never prints the password in auth status output", async () => {
    const keychainInstance = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychainInstance.readCredentials).mockResolvedValue({
      username: "bob",
      password: "v3ryS3cr3t",
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runAuthStatus({ keychain: keychainInstance });

    const all = [
      ...stdoutSpy.mock.calls.map((c) => c[0] as string),
      ...stderrSpy.mock.calls.map((c) => c[0] as string),
    ].join("");
    expect(all).not.toContain("v3ryS3cr3t");

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe("STEP-010: auth set — non-interactive guard", () => {
  // REQ-CLI-010
  it("exits 2 when --non-interactive and credentials already stored", async () => {
    const keychainInstance = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychainInstance.readCredentials).mockResolvedValue({
      username: "alice",
      password: "existing",
    });

    await expect(
      runAuthSet({ keychain: keychainInstance, nonInteractive: true, promptFn: vi.fn() })
    ).rejects.toMatchObject({ exitCode: 2 });
  });
});

// UC-03: msc auth set on non-macOS refuses immediately with env-var instructions
describe("UC-03: auth set on non-macOS", () => {
  it("prints refusal and env-var instructions when keychain is null", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const promptFn = vi.fn();
    await runAuthSet({ keychain: null, promptFn });
    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("not available on this platform");
    expect(output).toContain("MSC_USERNAME");
    expect(output).toContain("MSC_PASSWORD");
    expect(output).toContain("optional");
    expect(promptFn).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});

// UC-04: msc auth status shows env-var presence on non-macOS
describe("UC-04: auth status non-macOS env-var reporting", () => {
  it("reports MSC_USERNAME when set and keychain is null", async () => {
    vi.stubEnv("MSC_USERNAME", "s12345");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runAuthStatus({ keychain: null });
    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("MSC_USERNAME=s12345");
    stdoutSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("prints guidance when keychain null and MSC_USERNAME not set", async () => {
    vi.stubEnv("MSC_USERNAME", "");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runAuthStatus({ keychain: null });
    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("MSC_USERNAME");
    expect(output).toContain("MSC_PASSWORD");
    stdoutSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});
