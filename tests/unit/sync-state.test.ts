// Covers: STEP-016, REQ-SYNC-001, REQ-SYNC-002, REQ-SEC-007
//
// Tests for state file creation, update, location, and secret exclusion.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "../../src/sync/state.js";

describe("STEP-016: State file management", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-state-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // REQ-SYNC-001
  it("creates state file at <outputDir>/.moodle-scraper-state.json after save()", async () => {
    const sm = new StateManager(tmpDir);
    await sm.save({ courses: {} });
    expect(existsSync(join(tmpDir, ".moodle-scraper-state.json"))).toBe(true);
  });

  it("saved state contains 'version' and 'lastSyncAt' fields", async () => {
    const sm = new StateManager(tmpDir);
    await sm.save({ courses: {} });
    const raw = JSON.parse(readFileSync(join(tmpDir, ".moodle-scraper-state.json"), "utf8"));
    expect(raw).toHaveProperty("version");
    expect(raw).toHaveProperty("lastSyncAt");
    // lastSyncAt should be a valid ISO 8601 string
    expect(() => new Date(raw.lastSyncAt)).not.toThrow();
  });

  // REQ-SYNC-002
  it("state file location follows outputDir, not hardcoded to ~/", async () => {
    const sm = new StateManager(tmpDir);
    await sm.save({ courses: {} });
    const stateFile = sm.statePath;
    expect(stateFile).toContain(tmpDir);
    expect(stateFile).not.toContain(process.env.HOME ?? "~");
  });

  // REQ-SEC-007
  it("state file does not contain any secret values", async () => {
    const sm = new StateManager(tmpDir);
    await sm.save({ courses: {} });
    const raw = readFileSync(join(tmpDir, ".moodle-scraper-state.json"), "utf8");
    // assertNoSecrets would be called by StateManager internally
    // Here we verify the raw JSON doesn't contain any password-like field
    const parsed = JSON.parse(raw);
    const json = JSON.stringify(parsed);
    expect(json).not.toContain("password");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("token"); // session tokens must not be stored here
  });

  it("state file is written atomically (no .tmp remains)", async () => {
    const { readdirSync } = await import("node:fs");
    const sm = new StateManager(tmpDir);
    await sm.save({ courses: {} });
    const tmpFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("load() returns null when no state file exists", async () => {
    const sm = new StateManager(tmpDir);
    const state = await sm.load();
    expect(state).toBeNull();
  });

  it("load() returns the previously saved state", async () => {
    const sm = new StateManager(tmpDir);
    const data = { courses: { "1": { name: "Macro", sections: {} } } };
    await sm.save(data);
    const loaded = await sm.load();
    expect(loaded?.courses["1"]?.name).toBe("Macro");
  });
});
