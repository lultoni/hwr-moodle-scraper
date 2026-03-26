// Covers: STEP-002, REQ-CLI-007, REQ-FS-001
//
// Tests for config command: get/set/list/reset, config directory creation,
// outputDir default, and file permission enforcement.
// All tests are failing until STEP-002 is implemented.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We import the config manager directly to test it as a unit
// It accepts an optional configDir to allow test isolation

async function importConfigManager(configDir: string) {
  // Dynamic import so each test can provide its own configDir
  const mod = await import("../../src/config.js");
  return new mod.ConfigManager(configDir);
}

describe("STEP-002: Config management", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-config-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // REQ-CLI-007
  it("set() writes key to config file, get() reads it back", async () => {
    const cfg = await importConfigManager(tmpDir);
    await cfg.set("outputDir", "/tmp/my-output");
    expect(await cfg.get("outputDir")).toBe("/tmp/my-output");
  });

  // REQ-CLI-007
  it("list() returns all key=value pairs", async () => {
    const cfg = await importConfigManager(tmpDir);
    await cfg.set("outputDir", "/tmp/a");
    const entries = await cfg.list();
    expect(entries).toMatchObject({ outputDir: "/tmp/a" });
  });

  // REQ-CLI-007
  it("reset() restores outputDir default", async () => {
    const cfg = await importConfigManager(tmpDir);
    await cfg.set("outputDir", "/custom");
    await cfg.reset();
    const val = await cfg.get("outputDir");
    expect(val).toMatch(/moodle-scraper-output/);
  });

  // REQ-FS-001 — config dir created with 0700
  it("config directory is created with permissions 0700", async () => {
    const nestedDir = join(tmpDir, "nested", "config");
    await importConfigManager(nestedDir);
    const st = statSync(nestedDir);
    // 0o40700 = directory + rwx for owner only
    expect(st.mode & 0o777).toBe(0o700);
  });

  // REQ-CLI-007 — config file permissions 0600
  it("config file is written with permissions 0600", async () => {
    const cfg = await importConfigManager(tmpDir);
    await cfg.set("outputDir", "/tmp/test");
    const configPath = join(tmpDir, "config.json");
    const st = statSync(configPath);
    expect(st.mode & 0o777).toBe(0o600);
  });

  // REQ-CLI-007 — get() on missing key returns undefined
  it("get() returns undefined for an unknown key", async () => {
    const cfg = await importConfigManager(tmpDir);
    expect(await cfg.get("nonExistentKey" as never)).toBeUndefined();
  });
});
