// Covers: STEP-022, REQ-CLI-015
//
// Tests for the first-run setup wizard.
// Terminal I/O, auth, and config are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/keychain.js", () => ({
  KeychainAdapter: vi.fn().mockImplementation(() => ({
    readCredentials: vi.fn(),
    storeCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
  })),
}));

vi.mock("../../src/config.js", () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({}),
    reset: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../src/auth/prompt.js", () => ({
  promptAndAuthenticate: vi.fn().mockResolvedValue(undefined),
}));

import { runWizard, shouldRunWizard } from "../../src/commands/wizard.js";
import { KeychainAdapter } from "../../src/auth/keychain.js";
import { ConfigManager } from "../../src/config.js";
import { promptAndAuthenticate } from "../../src/auth/prompt.js";

describe("STEP-022: First-run wizard — detection", () => {
  // REQ-CLI-015
  it("shouldRunWizard returns true when no config and no credentials", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null);
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(undefined);

    const result = await shouldRunWizard({ keychain, config });
    expect(result).toBe(true);
  });

  it("shouldRunWizard returns false when credentials already exist", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue({ username: "alice", password: "pass" });
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue("/some/output/dir");

    const result = await shouldRunWizard({ keychain, config });
    expect(result).toBe(false);
  });
});

describe("STEP-022: First-run wizard — flow", () => {
  // REQ-CLI-015
  it("wizard prompts for outputDir and calls promptAndAuthenticate", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    const promptFn = vi.fn()
      .mockResolvedValueOnce("/custom/output") // outputDir input
      .mockResolvedValueOnce("alice")           // username
      .mockResolvedValueOnce("password123");    // password

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    expect(vi.mocked(config.set)).toHaveBeenCalledWith("outputDir", "/custom/output");
    expect(vi.mocked(promptAndAuthenticate)).toHaveBeenCalled();
  });

  it("wizard uses default outputDir when user presses Enter without input", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    const promptFn = vi.fn()
      .mockResolvedValueOnce("") // empty → use default
      .mockResolvedValueOnce("alice")
      .mockResolvedValueOnce("pass");

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    const setCall = vi.mocked(config.set).mock.calls.find((c) => c[0] === "outputDir");
    expect(setCall?.[1]).toMatch(/moodle-scraper-output/);
  });

  // REQ-CLI-010 — --non-interactive suppresses wizard
  it("--non-interactive: wizard does not run, throws exitCode 3 when no credentials", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null);
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;

    await expect(
      runWizard({ keychain, config, promptFn: vi.fn(), httpClient: {} as never, nonInteractive: true })
    ).rejects.toMatchObject({ exitCode: 3 });
  });

  // REQ-CLI-015 — wizard does not fire on subsequent runs
  it("wizard does not fire when credentials and config already exist", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue({ username: "alice", password: "pass" });
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue("/existing/output");

    const result = await shouldRunWizard({ keychain, config });
    expect(result).toBe(false);
  });
});
