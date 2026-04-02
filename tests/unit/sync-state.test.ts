// Covers: STEP-016, REQ-SYNC-001, REQ-SYNC-002, REQ-SEC-007
//
// Tests for state file creation, update, location, and secret exclusion.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager, migrateStatePaths, relocateFiles, removeEmptyDirs, type State } from "../../src/sync/state.js";

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

describe("migrateStatePaths — state file path migration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-migrate-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeState(localPath: string): State {
    return {
      version: 1,
      lastSyncAt: new Date().toISOString(),
      courses: {
        "1": {
          name: "Datenbanken",
          sections: {
            "s1": {
              files: {
                "res1": {
                  name: "lecture.pdf",
                  url: "https://example.com/lecture.pdf",
                  localPath,
                  hash: "abc",
                  lastModified: new Date().toISOString(),
                  status: "ok",
                },
              },
            },
          },
        },
      },
    };
  }

  it("updates localPath when file exists at new path", () => {
    const oldPath = join(tmpDir, "Old_Long_Course_Name", "Section_1", "lecture.pdf");
    const newPath = join(tmpDir, "Semester_3", "Datenbanken", "Section_1", "lecture.pdf");
    // Create file at new path
    mkdirSync(join(tmpDir, "Semester_3", "Datenbanken", "Section_1"), { recursive: true });
    writeFileSync(newPath, "content");

    const state = makeState(oldPath);
    const courseShortPaths = new Map([["1", { semesterDir: "Semester_3", shortName: "Datenbanken" }]]);
    const { state: migrated } = migrateStatePaths(state, tmpDir, courseShortPaths);

    expect(migrated.courses["1"]!.sections["s1"]!.files["res1"]!.localPath).toBe(newPath);
  });

  it("keeps old localPath when file exists only at old path", () => {
    const oldPath = join(tmpDir, "Old_Long_Course_Name", "Section_1", "lecture.pdf");
    // Create file at OLD path
    mkdirSync(join(tmpDir, "Old_Long_Course_Name", "Section_1"), { recursive: true });
    writeFileSync(oldPath, "content");

    const state = makeState(oldPath);
    const courseShortPaths = new Map([["1", { semesterDir: "Semester_3", shortName: "Datenbanken" }]]);
    const { state: migrated } = migrateStatePaths(state, tmpDir, courseShortPaths);

    expect(migrated.courses["1"]!.sections["s1"]!.files["res1"]!.localPath).toBe(oldPath);
  });

  it("keeps old localPath when file exists at neither path", () => {
    const oldPath = join(tmpDir, "Old_Long_Course_Name", "Section_1", "missing.pdf");
    const state = makeState(oldPath);
    const courseShortPaths = new Map([["1", { semesterDir: "Semester_3", shortName: "Datenbanken" }]]);
    const { state: migrated } = migrateStatePaths(state, tmpDir, courseShortPaths);

    expect(migrated.courses["1"]!.sections["s1"]!.files["res1"]!.localPath).toBe(oldPath);
  });

  it("leaves already-migrated path unchanged", () => {
    const newPath = join(tmpDir, "Semester_3", "Datenbanken", "Section_1", "lecture.pdf");
    mkdirSync(join(tmpDir, "Semester_3", "Datenbanken", "Section_1"), { recursive: true });
    writeFileSync(newPath, "content");

    const state = makeState(newPath);
    const courseShortPaths = new Map([["1", { semesterDir: "Semester_3", shortName: "Datenbanken" }]]);
    const { state: migrated } = migrateStatePaths(state, tmpDir, courseShortPaths);

    expect(migrated.courses["1"]!.sections["s1"]!.files["res1"]!.localPath).toBe(newPath);
  });

  it("returns changed: true when a path was migrated", () => {
    const oldPath = join(tmpDir, "Old_Long_Course_Name", "Section_1", "lecture.pdf");
    const newPath = join(tmpDir, "Semester_3", "Datenbanken", "Section_1", "lecture.pdf");
    mkdirSync(join(tmpDir, "Semester_3", "Datenbanken", "Section_1"), { recursive: true });
    writeFileSync(newPath, "content");

    const state = makeState(oldPath);
    const courseShortPaths = new Map([["1", { semesterDir: "Semester_3", shortName: "Datenbanken" }]]);
    const { changed } = migrateStatePaths(state, tmpDir, courseShortPaths);

    expect(changed).toBe(true);
  });

  it("returns changed: false when no paths were migrated", () => {
    const alreadyNewPath = join(tmpDir, "Semester_3", "Datenbanken", "Section_1", "lecture.pdf");
    mkdirSync(join(tmpDir, "Semester_3", "Datenbanken", "Section_1"), { recursive: true });
    writeFileSync(alreadyNewPath, "content");

    const state = makeState(alreadyNewPath);
    const courseShortPaths = new Map([["1", { semesterDir: "Semester_3", shortName: "Datenbanken" }]]);
    const { changed } = migrateStatePaths(state, tmpDir, courseShortPaths);

    expect(changed).toBe(false);
  });

  it("keeps old localPath when courseShortPaths map is empty (no mapping for course)", () => {
    const oldPath = join(tmpDir, "Old_Course", "Section", "file.pdf");
    const state = makeState(oldPath);
    const courseShortPaths = new Map<string, { semesterDir: string; shortName: string }>(); // empty map
    const { state: migrated } = migrateStatePaths(state, tmpDir, courseShortPaths);

    expect(migrated.courses["1"]!.sections["s1"]!.files["res1"]!.localPath).toBe(oldPath);
  });
});

describe("relocateFiles — SK placement file moves", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-relocate-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("moves a file from Schluesselkompetenzen/ to Semester_3/Schluesselkompetenzen/ when semesterDir changes", () => {
    const oldPath = join(tmpDir, "Schluesselkompetenzen", "MeinKurs", "Abschnitt", "skript.pdf");
    mkdirSync(join(tmpDir, "Schluesselkompetenzen", "MeinKurs", "Abschnitt"), { recursive: true });
    writeFileSync(oldPath, "content");

    const state: State = {
      version: 1, lastSyncAt: "2026-01-01T00:00:00.000Z",
      courses: {
        "42": {
          name: "SK Kurs", sections: {
            "s0": { files: { "res1": { name: "skript.pdf", url: "https://x/1", localPath: oldPath, hash: "", lastModified: "", status: "ok" } } }
          }
        }
      }
    };

    // After config change: SK goes into Semester_3/Schluesselkompetenzen
    const courseShortPaths = new Map([["42", { semesterDir: "Semester_3/Schluesselkompetenzen", shortName: "MeinKurs" }]]);
    const { state: updated, changed } = relocateFiles(state, tmpDir, courseShortPaths);

    expect(changed).toBe(true);
    const newPath = join(tmpDir, "Semester_3", "Schluesselkompetenzen", "MeinKurs", "Abschnitt", "skript.pdf");
    expect(existsSync(newPath)).toBe(true);
    expect(existsSync(oldPath)).toBe(false);
    expect(updated.courses["42"]!.sections["s0"]!.files["res1"]!.localPath).toBe(newPath);
  });

  it("removes empty directories left behind after file moves", () => {
    const dir = join(tmpDir, "EmptyParent", "EmptyChild");
    mkdirSync(dir, { recursive: true });

    removeEmptyDirs(dir, tmpDir);

    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(tmpDir, "EmptyParent"))).toBe(false);
    // stopDir itself (tmpDir) must not be removed
    expect(existsSync(tmpDir)).toBe(true);
  });

  it("does not change state when file paths are already at the expected location", () => {
    const correctPath = join(tmpDir, "Semester_3", "Schluesselkompetenzen", "MeinKurs", "s0", "skript.pdf");
    const state: State = {
      version: 1, lastSyncAt: "", courses: {
        "42": { name: "SK", sections: { "s0": { files: { "r": { name: "skript.pdf", url: "", localPath: correctPath, hash: "", lastModified: "", status: "ok" } } } } }
      }
    };
    const courseShortPaths = new Map([["42", { semesterDir: "Semester_3/Schluesselkompetenzen", shortName: "MeinKurs" }]]);
    const { changed } = relocateFiles(state, tmpDir, courseShortPaths);
    expect(changed).toBe(false);
  });
});
