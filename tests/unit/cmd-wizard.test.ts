// Covers: STEP-022, REQ-CLI-015
//
// Tests for the first-run setup wizard.
// Terminal I/O, auth, and config are mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

  it("shouldRunWizard returns false when credentials already exist and outputDir set", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue({ username: "alice", password: "pass" });
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue("/some/output/dir");

    const result = await shouldRunWizard({ keychain, config });
    expect(result).toBe(false);
  });

  it("shouldRunWizard returns true when credentials exist but outputDir is empty (post-full-reset)", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue({ username: "alice", password: "pass" });
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(""); // empty string = not configured

    const result = await shouldRunWizard({ keychain, config });
    expect(result).toBe(true);
  });

  it("shouldRunWizard returns true when credentials exist but outputDir is undefined", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue({ username: "alice", password: "pass" });
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(undefined);

    const result = await shouldRunWizard({ keychain, config });
    expect(result).toBe(true);
  });
});

describe("STEP-022: First-run wizard — flow", () => {
  beforeEach(() => {
    vi.mocked(promptAndAuthenticate).mockClear();
  });

  // REQ-CLI-015
  it("wizard prompts for outputDir and calls promptAndAuthenticate", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null); // no credentials → ask
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(undefined);
    const promptFn = vi.fn()
      .mockResolvedValueOnce("/custom/output") // outputDir input
      .mockResolvedValueOnce("");              // logFile (→ null)

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    expect(vi.mocked(config.set)).toHaveBeenCalledWith("outputDir", "/custom/output");
    expect(vi.mocked(promptAndAuthenticate)).toHaveBeenCalled();
  });

  it("wizard uses default outputDir when user presses Enter without input", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null);
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(undefined);
    const promptFn = vi.fn()
      .mockResolvedValueOnce("") // empty → use default hint
      .mockResolvedValueOnce(""); // logFile

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    const setCall = vi.mocked(config.set).mock.calls.find((c) => c[0] === "outputDir");
    expect(setCall?.[1]).toMatch(/moodle-scraper-output/);
  });

  // REQ-CLI-010 — --non-interactive suppresses wizard
  it("--non-interactive: wizard does not run, throws exitCode 3 when no credentials", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null);
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(undefined);

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

  it("wizard asks only for outputDir (not credentials) when credentials are still set", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue({ username: "alice", password: "pass" });
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(""); // outputDir missing
    const promptFn = vi.fn()
      .mockResolvedValueOnce("/new/output") // outputDir
      .mockResolvedValueOnce("");           // logFile

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    expect(vi.mocked(config.set)).toHaveBeenCalledWith("outputDir", "/new/output");
    // Credentials prompt should NOT have been called — creds already exist
    expect(vi.mocked(promptAndAuthenticate)).not.toHaveBeenCalled();
  });
});

describe("STEP-022: Wizard — logFile prompt", () => {
  it("saves logFile path when user enters one", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null);
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(undefined);
    const promptFn = vi.fn()
      .mockResolvedValueOnce("")                    // outputDir
      .mockResolvedValueOnce("~/moodle-scraper.log"); // logFile

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    expect(vi.mocked(config.set)).toHaveBeenCalledWith("logFile", "~/moodle-scraper.log");
  });

  it("saves logFile=null when user presses Enter (no log file)", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null);
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(undefined);
    const promptFn = vi.fn()
      .mockResolvedValueOnce("") // outputDir
      .mockResolvedValueOnce(""); // logFile → null

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    expect(vi.mocked(config.set)).toHaveBeenCalledWith("logFile", null);
  });
});

describe("STEP-022: Wizard — logFile directory validation", () => {
  // Covers Fix 1: wizard rejects directory paths (ending with /) and retries
  it("retries logFile prompt when user enters a path ending with /", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null);
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(undefined);
    const promptFn = vi.fn()
      .mockResolvedValueOnce("")                          // outputDir
      .mockResolvedValueOnce("/some/dir/")               // logFile — invalid (directory path)
      .mockResolvedValueOnce("~/moodle-scraper.log");    // logFile — valid on retry

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    expect(vi.mocked(config.set)).toHaveBeenCalledWith("logFile", "~/moodle-scraper.log");
    // promptFn was called 3 times: outputDir + 2x logFile
    expect(promptFn).toHaveBeenCalledTimes(3);
  });

  it("accepts empty logFile (skip) even after a bad entry", async () => {
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null);
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(undefined);
    const promptFn = vi.fn()
      .mockResolvedValueOnce("")           // outputDir
      .mockResolvedValueOnce("/bad/dir/")  // logFile — invalid
      .mockResolvedValueOnce("");          // logFile — skip (Enter) → null

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    expect(vi.mocked(config.set)).toHaveBeenCalledWith("logFile", null);
  });
});

// T-21: env-var credential awareness in wizard
describe("T-21: Wizard — env-var credential awareness", () => {
  beforeEach(() => {
    vi.mocked(promptAndAuthenticate).mockClear();
    delete process.env["MSC_USERNAME"];
    delete process.env["MSC_PASSWORD"];
  });

  afterEach(() => {
    delete process.env["MSC_USERNAME"];
    delete process.env["MSC_PASSWORD"];
  });

  it("shouldRunWizard returns false when MSC_USERNAME + MSC_PASSWORD env vars set and outputDir configured", async () => {
    // Env vars cover auth — no wizard needed even with no credentials.enc
    process.env["MSC_USERNAME"] = "s12345";
    process.env["MSC_PASSWORD"] = "secret";
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null); // no credentials.enc
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue("/some/output/dir");

    const result = await shouldRunWizard({ keychain, config });
    expect(result).toBe(false);
  });

  it("shouldRunWizard returns true when env vars set but outputDir missing", async () => {
    // Auth is covered by env vars but outputDir must still be configured
    process.env["MSC_USERNAME"] = "s12345";
    process.env["MSC_PASSWORD"] = "secret";
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null);
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(undefined);

    const result = await shouldRunWizard({ keychain, config });
    expect(result).toBe(true);
  });

  it("runWizard returns immediately (no prompts) when env vars set and outputDir configured", async () => {
    // Both auth and outputDir are covered — wizard does nothing
    process.env["MSC_USERNAME"] = "s12345";
    process.env["MSC_PASSWORD"] = "secret";
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null); // no credentials.enc
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue("/existing/output");
    const promptFn = vi.fn();

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    expect(promptFn).not.toHaveBeenCalled();
    expect(vi.mocked(promptAndAuthenticate)).not.toHaveBeenCalled();
  });

  it("runWizard asks only outputDir when env vars set but outputDir missing (no credential prompt)", async () => {
    // Env vars cover auth — only outputDir needs to be set
    process.env["MSC_USERNAME"] = "s12345";
    process.env["MSC_PASSWORD"] = "secret";
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null);
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue(undefined); // outputDir missing
    const promptFn = vi.fn()
      .mockResolvedValueOnce("/my/output") // outputDir
      .mockResolvedValueOnce("");          // logFile

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    expect(vi.mocked(config.set)).toHaveBeenCalledWith("outputDir", "/my/output");
    // Credential prompt must NOT have been called — env vars cover it
    expect(vi.mocked(promptAndAuthenticate)).not.toHaveBeenCalled();
  });

  it("runWizard does not re-ask outputDir when already set (only credential prompt needed)", async () => {
    // outputDir is configured; only credentials are missing (no env vars either)
    const keychain = new (vi.mocked(KeychainAdapter))() as never;
    vi.mocked(keychain.readCredentials).mockResolvedValue(null); // no stored creds, no env vars
    const config = new (vi.mocked(ConfigManager))("/tmp/test") as never;
    vi.mocked(config.get).mockResolvedValue("/existing/output"); // outputDir already set
    const promptFn = vi.fn();

    await runWizard({ keychain, config, promptFn, httpClient: {} as never });

    // outputDir prompt (config.set for outputDir) must NOT have been called
    expect(vi.mocked(config.set)).not.toHaveBeenCalledWith("outputDir", expect.anything());
    // Credential prompt MUST have been called (no stored creds, no env vars)
    expect(vi.mocked(promptAndAuthenticate)).toHaveBeenCalled();
  });
});
