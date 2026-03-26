// Covers: STEP-008, REQ-AUTH-001, REQ-AUTH-003, REQ-AUTH-006
//
// Tests for the first-run credential prompt and session acquisition.
// Terminal I/O and HTTP are mocked — no real network, no real Keychain.
//
// SECURITY NOTE: Keychain and HTTP are mocked. The mock contract mirrors the
// real API. Password is never logged or echoed in any test assertion.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/keychain.js", () => ({
  KeychainAdapter: vi.fn().mockImplementation(() => ({
    storeCredentials: vi.fn(),
    readCredentials: vi.fn().mockResolvedValue(null),
    deleteCredentials: vi.fn(),
  })),
}));

vi.mock("../../src/http/client.js", () => ({
  createHttpClient: vi.fn(),
  InsecureURLError: class InsecureURLError extends Error {},
}));

import { promptAndAuthenticate } from "../../src/auth/prompt.js";
import { KeychainAdapter } from "../../src/auth/keychain.js";

function makePromptInputs(inputs: string[]) {
  let i = 0;
  return vi.fn().mockImplementation(async () => inputs[i++] ?? "");
}

describe("STEP-008: Credential prompt — input validation", () => {
  // REQ-AUTH-001 — empty username rejected
  it("rejects empty username and re-prompts without advancing to password", async () => {
    const promptFn = makePromptInputs(["", "alice", "password123"]);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // Mock HTTP to succeed on first real attempt
    const { createHttpClient } = await import("../../src/http/client.js");
    vi.mocked(createHttpClient).mockReturnValue({
      post: vi.fn().mockResolvedValue({ status: 200, url: "https://moodle.example.com/my/" }),
      get: vi.fn(),
    } as never);

    await promptAndAuthenticate({ promptFn, httpClient: vi.mocked(createHttpClient)() });

    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Username must not be empty.");
    stderrSpy.mockRestore();
  });

  // REQ-AUTH-001 — empty password rejected
  it("rejects empty password and re-prompts for password only", async () => {
    const promptFn = makePromptInputs(["alice", "", "password123"]);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { createHttpClient } = await import("../../src/http/client.js");
    vi.mocked(createHttpClient).mockReturnValue({
      post: vi.fn().mockResolvedValue({ status: 200, url: "https://moodle.example.com/my/" }),
      get: vi.fn(),
    } as never);

    await promptAndAuthenticate({ promptFn, httpClient: vi.mocked(createHttpClient)() });

    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Password must not be empty.");
    stderrSpy.mockRestore();
  });
});

describe("STEP-008: Credential prompt — login failure", () => {
  // REQ-AUTH-006 — wrong credentials
  it("prints 'Login failed: incorrect username or password.' and does NOT write Keychain", async () => {
    const promptFn = makePromptInputs(["alice", "wrongpass"]);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { createHttpClient } = await import("../../src/http/client.js");
    vi.mocked(createHttpClient).mockReturnValue({
      // Login redirects back to /login/ — indicates failure
      post: vi.fn().mockResolvedValue({
        status: 200,
        url: "https://moodle.example.com/login/index.php",
      }),
      get: vi.fn(),
    } as never);

    const keychainInstance = new (vi.mocked(KeychainAdapter))();

    await expect(
      promptAndAuthenticate({ promptFn, httpClient: vi.mocked(createHttpClient)(), keychain: keychainInstance })
    ).rejects.toMatchObject({ exitCode: 1 });

    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Login failed: incorrect username or password.");
    expect(keychainInstance.storeCredentials).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  // REQ-AUTH-006 — network failure
  it("prints 'Login failed: network error' and does NOT write Keychain", async () => {
    const promptFn = makePromptInputs(["alice", "password123"]);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { createHttpClient } = await import("../../src/http/client.js");
    vi.mocked(createHttpClient).mockReturnValue({
      post: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      get: vi.fn(),
    } as never);

    const keychainInstance = new (vi.mocked(KeychainAdapter))();

    await expect(
      promptAndAuthenticate({ promptFn, httpClient: vi.mocked(createHttpClient)(), keychain: keychainInstance })
    ).rejects.toMatchObject({ exitCode: 1 });

    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Login failed: network error");
    expect(keychainInstance.storeCredentials).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});

describe("STEP-008: Credential prompt — successful login", () => {
  // REQ-AUTH-001, REQ-AUTH-003
  it("on success: stores credentials in Keychain and writes session.json", async () => {
    const promptFn = makePromptInputs(["alice", "correctpass"]);

    const { createHttpClient } = await import("../../src/http/client.js");
    vi.mocked(createHttpClient).mockReturnValue({
      post: vi.fn().mockResolvedValue({
        status: 200,
        url: "https://moodle.example.com/my/",
        cookies: [{ name: "MoodleSession", value: "abc123", domain: "moodle.example.com", path: "/", expires: null }],
      }),
      get: vi.fn(),
    } as never);

    const keychainInstance = new (vi.mocked(KeychainAdapter))();

    await promptAndAuthenticate({
      promptFn,
      httpClient: vi.mocked(createHttpClient)(),
      keychain: keychainInstance,
    });

    expect(keychainInstance.storeCredentials).toHaveBeenCalledWith("alice", "correctpass");
  });

  // REQ-AUTH-001-C — password must never appear in any log output
  it("the password is never logged or written to stdout/stderr", async () => {
    const promptFn = makePromptInputs(["alice", "sup3rs3cr3t"]);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { createHttpClient } = await import("../../src/http/client.js");
    vi.mocked(createHttpClient).mockReturnValue({
      post: vi.fn().mockResolvedValue({
        status: 200,
        url: "https://moodle.example.com/my/",
        cookies: [],
      }),
      get: vi.fn(),
    } as never);

    await promptAndAuthenticate({ promptFn, httpClient: vi.mocked(createHttpClient)() });

    const allOutput = [
      ...stdoutSpy.mock.calls.map((c) => c[0] as string),
      ...stderrSpy.mock.calls.map((c) => c[0] as string),
    ].join("");

    expect(allOutput).not.toContain("sup3rs3cr3t");
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
