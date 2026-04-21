// Covers: STEP-001, REQ-CLI-001, REQ-CLI-011, REQ-CLI-013, REQ-CLI-014
//
// Tests for the CLI scaffold: entry point, version flag, help text, exit codes,
// and unknown command handling. All tests are failing until STEP-001 is implemented.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const BIN = resolve(__dirname, "../../src/index.ts");

function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("node", ["--import", "tsx/esm", BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test" },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

describe("STEP-001: CLI scaffold", () => {
  // REQ-CLI-014
  it("--version prints 'moodle-scraper x.y.z' and exits 0", () => {
    const { stdout, status } = runCli(["--version"]);
    expect(stdout.trim()).toMatch(/^moodle-scraper \d+\.\d+\.\d+$/);
    expect(status).toBe(0);
  });

  // REQ-CLI-001 — alias 'msc' is tested via the bin field, not directly here
  it("-V is an alias for --version", () => {
    const { stdout, status } = runCli(["-V"]);
    expect(stdout.trim()).toMatch(/^moodle-scraper \d+\.\d+\.\d+$/);
    expect(status).toBe(0);
  });

  // REQ-CLI-013
  it("--help prints usage summary with all top-level commands and exits 0", () => {
    const { stdout, status } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("scrape");
    expect(stdout).toContain("auth");
    expect(stdout).toContain("config");
    expect(stdout).toContain("status");
  });

  // REQ-CLI-011 — unknown command exits 2
  it("unknown command prints error to stderr and exits 2", () => {
    const { stderr, status } = runCli(["unknowncmd"]);
    expect(status).toBe(2);
    expect(stderr).toContain("Unknown command: unknowncmd");
    expect(stderr).toContain("moodle-scraper --help");
  });

  // REQ-CLI-011 — exit code constants are importable
  it("EXIT_CODES module exports the required constants", async () => {
    // This import will fail until src/exit-codes.ts exists
    const { EXIT_CODES } = await import("../../src/exit-codes.js");
    expect(EXIT_CODES.SUCCESS).toBe(0);
    expect(EXIT_CODES.ERROR).toBe(1);
    expect(EXIT_CODES.USAGE_ERROR).toBe(2);
    expect(EXIT_CODES.AUTH_ERROR).toBe(3);
    expect(EXIT_CODES.NETWORK_ERROR).toBe(4);
    expect(EXIT_CODES.FILESYSTEM_ERROR).toBe(5);
  });
});

describe("config set — nullable key coercion", () => {
  // Covers Fix 2: coerceConfigValue must convert string "null" to actual null for nullable keys
  it("coerceConfigValue('logFile', 'null') returns null", async () => {
    const { coerceConfigValue } = await import("../../src/config.js");
    expect(coerceConfigValue("logFile", "null")).toBeNull();
  });

  it("coerceConfigValue('postScrapeHook', 'null') returns null", async () => {
    const { coerceConfigValue } = await import("../../src/config.js");
    expect(coerceConfigValue("postScrapeHook", "null")).toBeNull();
  });

  it("coerceConfigValue('courseSearch', 'null') returns null", async () => {
    const { coerceConfigValue } = await import("../../src/config.js");
    expect(coerceConfigValue("courseSearch", "null")).toBeNull();
  });

  it("coerceConfigValue('logFile', '/path/to/file.log') returns the path string", async () => {
    const { coerceConfigValue } = await import("../../src/config.js");
    expect(coerceConfigValue("logFile", "/path/to/file.log")).toBe("/path/to/file.log");
  });

  it("coerceConfigValue('requestDelayMs', '1000') returns the number 1000", async () => {
    const { coerceConfigValue } = await import("../../src/config.js");
    expect(coerceConfigValue("requestDelayMs", "1000")).toBe(1000);
  });
});
