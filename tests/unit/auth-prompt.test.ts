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

const LOGIN_PAGE_HTML = `<html><body>
  <input type="hidden" name="logintoken" value="abc123token">
</body></html>`;

const SUCCESS_URL = "https://moodle.example.com/my/";
const FAIL_URL = "https://moodle.example.com/login/index.php";

function makePromptInputs(inputs: string[]) {
  let i = 0;
  return vi.fn().mockImplementation(async () => inputs[i++] ?? "");
}

function makeHttpClient(opts: { postUrl: string; succeeds?: boolean }) {
  const { createHttpClient } = require("../../src/http/client.js");
  vi.mocked(createHttpClient).mockReturnValue({
    get: vi.fn().mockResolvedValue({ status: 200, url: "https://moodle.example.com/login/index.php", body: LOGIN_PAGE_HTML, headers: {} }),
    post: vi.fn().mockResolvedValue({ status: 200, url: opts.postUrl }),
  } as never);
  return vi.mocked(createHttpClient)();
}

describe("STEP-008: Credential prompt — input validation", () => {
  // REQ-AUTH-001 — empty username rejected
  it("rejects empty username and re-prompts without advancing to password", async () => {
    const promptFn = makePromptInputs(["", "alice", "password123"]);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { createHttpClient } = await import("../../src/http/client.js");
    vi.mocked(createHttpClient).mockReturnValue({
      get: vi.fn().mockResolvedValue({ status: 200, url: FAIL_URL, body: LOGIN_PAGE_HTML, headers: {} }),
      post: vi.fn().mockResolvedValue({ status: 200, url: SUCCESS_URL }),
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
      get: vi.fn().mockResolvedValue({ status: 200, url: FAIL_URL, body: LOGIN_PAGE_HTML, headers: {} }),
      post: vi.fn().mockResolvedValue({ status: 200, url: SUCCESS_URL }),
    } as never);

    await promptAndAuthenticate({ promptFn, httpClient: vi.mocked(createHttpClient)() });

    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Password must not be empty.");
    stderrSpy.mockRestore();
  });

  // REQ-AUTH-001 — password prompt uses masked=true flag
  it("calls promptFn with masked=true for the password field", async () => {
    const promptFn = vi.fn().mockImplementation(async () => "value");
    const { createHttpClient } = await import("../../src/http/client.js");
    vi.mocked(createHttpClient).mockReturnValue({
      get: vi.fn().mockResolvedValue({ status: 200, url: FAIL_URL, body: LOGIN_PAGE_HTML, headers: {} }),
      post: vi.fn().mockResolvedValue({ status: 200, url: SUCCESS_URL }),
    } as never);

    await promptAndAuthenticate({ promptFn, httpClient: vi.mocked(createHttpClient)() });

    const passwordCall = promptFn.mock.calls.find((c) => c[0] === "Password: ");
    expect(passwordCall).toBeDefined();
    expect(passwordCall?.[1]).toBe(true);
  });
});

describe("STEP-008: Credential prompt — CSRF logintoken", () => {
  it("fetches login page first and includes logintoken in POST body", async () => {
    const promptFn = makePromptInputs(["alice", "correctpass"]);
    const { createHttpClient } = await import("../../src/http/client.js");
    const getMock = vi.fn().mockResolvedValue({
      status: 200,
      url: FAIL_URL,
      body: LOGIN_PAGE_HTML,
      headers: { "set-cookie": "MoodleSession=abc; path=/; secure" },
    });
    const postMock = vi.fn().mockResolvedValue({ status: 200, url: SUCCESS_URL });
    vi.mocked(createHttpClient).mockReturnValue({ get: getMock, post: postMock } as never);

    await promptAndAuthenticate({ promptFn, httpClient: vi.mocked(createHttpClient)() });

    expect(getMock).toHaveBeenCalledWith(expect.stringContaining("/login/index.php"));
    expect(postMock).toHaveBeenCalledWith(
      expect.stringContaining("/login/index.php"),
      expect.objectContaining({ logintoken: "abc123token" }),
      expect.objectContaining({ cookie: "MoodleSession=abc" })
    );
  });

  it("proceeds without logintoken if login page fetch fails", async () => {
    const promptFn = makePromptInputs(["alice", "correctpass"]);
    const { createHttpClient } = await import("../../src/http/client.js");
    const postMock = vi.fn().mockResolvedValue({ status: 200, url: SUCCESS_URL });
    vi.mocked(createHttpClient).mockReturnValue({
      get: vi.fn().mockRejectedValue(new Error("network error")),
      post: postMock,
    } as never);

    await promptAndAuthenticate({ promptFn, httpClient: vi.mocked(createHttpClient)() });

    expect(postMock).toHaveBeenCalledWith(
      expect.stringContaining("/login/index.php"),
      expect.not.objectContaining({ logintoken: expect.anything() }),
      undefined
    );
  });
});

describe("STEP-008: Credential prompt — login failure", () => {
  // REQ-AUTH-006 — wrong credentials
  it("prints 'Login failed: incorrect username or password.' and does NOT write Keychain", async () => {
    const promptFn = makePromptInputs(["alice", "wrongpass"]);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { createHttpClient } = await import("../../src/http/client.js");
    vi.mocked(createHttpClient).mockReturnValue({
      get: vi.fn().mockResolvedValue({ status: 200, url: FAIL_URL, body: LOGIN_PAGE_HTML, headers: {} }),
      post: vi.fn().mockResolvedValue({ status: 200, url: FAIL_URL }),
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
      get: vi.fn().mockResolvedValue({ status: 200, url: FAIL_URL, body: LOGIN_PAGE_HTML, headers: {} }),
      post: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
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
  it("on success: stores credentials in Keychain", async () => {
    const promptFn = makePromptInputs(["alice", "correctpass"]);

    const { createHttpClient } = await import("../../src/http/client.js");
    vi.mocked(createHttpClient).mockReturnValue({
      get: vi.fn().mockResolvedValue({ status: 200, url: FAIL_URL, body: LOGIN_PAGE_HTML, headers: {} }),
      post: vi.fn().mockResolvedValue({ status: 200, url: SUCCESS_URL }),
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
      get: vi.fn().mockResolvedValue({ status: 200, url: FAIL_URL, body: LOGIN_PAGE_HTML, headers: {} }),
      post: vi.fn().mockResolvedValue({ status: 200, url: SUCCESS_URL }),
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
