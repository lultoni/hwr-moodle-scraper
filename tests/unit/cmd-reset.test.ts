// Covers: msc reset command

import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

// --- fs mocks ---
const mockUnlinkSync = vi.fn();
const mockRmdirSync = vi.fn();
const mockReaddirSync = vi.fn().mockReturnValue([]);
const mockExistsSync = vi.fn().mockReturnValue(true);
const mockMkdirSync = vi.fn();
const mockRenameSync = vi.fn();
const mockStatSync = vi.fn().mockReturnValue({ size: 1000 });

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  rmdirSync: (...args: unknown[]) => mockRmdirSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
}));

// --- collect mock ---
const mockCollectFiles = vi.fn().mockReturnValue([]);
const mockGroupUserFiles = vi.fn().mockReturnValue([]);
vi.mock("../../src/fs/collect.js", () => ({
  collectFiles: (...args: unknown[]) => mockCollectFiles(...args),
  groupUserFiles: (...args: unknown[]) => mockGroupUserFiles(...args),
  renderTree: (paths: string[], rootDir: string) => {
    const { relative } = require("node:path");
    return paths.map((p: string) => relative(rootDir, p)).join("\n");
  },
}));

// --- selectItem mock ---
const mockSelectItem = vi.fn().mockResolvedValue("skip");
vi.mock("../../src/tui/select.js", () => ({
  selectItem: (...args: unknown[]) => mockSelectItem(...args),
}));

// --- StateManager mock ---
const mockLoad = vi.fn();
const mockRemoveEmptyDirs = vi.fn();
vi.mock("../../src/sync/state.js", () => ({
  StateManager: vi.fn().mockImplementation((outputDir: string) => ({
    load: mockLoad,
    statePath: `${outputDir}/.moodle-scraper-state.json`,
    backupPath: `${outputDir}/.moodle-scraper-state.json.bak`,
  })),
  removeEmptyDirs: (...args: unknown[]) => mockRemoveEmptyDirs(...args),
}));

// --- ConfigManager mock ---
const mockConfigReset = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/config.js", () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    reset: mockConfigReset,
  })),
}));

// --- KeychainAdapter mock ---
const mockDeleteCredentials = vi.fn().mockResolvedValue(undefined);
const mockKeychain = {
  deleteCredentials: mockDeleteCredentials,
};
vi.mock("../../src/auth/keychain.js", () => ({
  KeychainAdapter: vi.fn().mockImplementation(() => mockKeychain),
  tryCreateKeychain: vi.fn(() => mockKeychain),
}));

// --- deleteSessionFile mock ---
const mockDeleteSessionFile = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/auth/session.js", () => ({
  deleteSessionFile: (...args: unknown[]) => mockDeleteSessionFile(...args),
}));

import { runReset } from "../../src/commands/reset.js";

/** Build a minimal state with one course containing one file. */
function makeState(localPath = "/out/Course/Section/file.pdf") {
  return {
    version: 1,
    lastSyncAt: "2026-04-02T10:00:00.000Z",
    courses: {
      "1": {
        name: "TestCourse",
        sections: {
          s1: { files: { r1: { status: "ok", localPath, url: "https://example.com/r1", hash: "abc", lastModified: "" } } },
        },
      },
    },
  };
}

describe("msc reset — state-only (default)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
  });

  it("prints 'Nothing to reset.' and returns when no state exists and no config/credentials flags", async () => {
    mockLoad.mockResolvedValue(null);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true });
    expect(spy.mock.calls.flat().join("")).toContain("Nothing to reset.");
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // Regression: --config should still run even when no state file exists (fresh install)
  it("--config resets config even when no state file exists", async () => {
    mockLoad.mockResolvedValue(null);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", config: true, force: true });
    expect(mockConfigReset).toHaveBeenCalled();
    spy.mockRestore();
  });

  // Regression: --credentials should still run even when no state file exists (fresh install)
  it("--credentials clears credentials even when no state file exists", async () => {
    mockLoad.mockResolvedValue(null);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", credentials: true, force: true });
    expect(mockDeleteCredentials).toHaveBeenCalled();
    expect(mockDeleteSessionFile).toHaveBeenCalled();
    spy.mockRestore();
  });

  // Regression: --files --config --credentials should not crash on fresh install with no state
  it("--files --credentials --config does NOT print 'Nothing to reset.' on fresh install", async () => {
    mockLoad.mockResolvedValue(null);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", files: true, credentials: true, config: true, force: true });
    expect(spy.mock.calls.flat().join("")).not.toContain("Nothing to reset.");
    expect(mockConfigReset).toHaveBeenCalled();
    expect(mockDeleteCredentials).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("default reset deletes ONLY state file, not tracked files", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true });
    // Should NOT delete the tracked pdf
    expect(mockUnlinkSync).not.toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    // Should delete state file
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/.moodle-scraper-state.json");
    spy.mockRestore();
  });

  it("default reset does NOT call config.reset or deleteCredentials", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true });
    expect(mockConfigReset).not.toHaveBeenCalled();
    expect(mockDeleteCredentials).not.toHaveBeenCalled();
    expect(mockDeleteSessionFile).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("confirmation prompt: 'n' aborts without deleting state", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const promptFn = vi.fn().mockResolvedValue("n");
    await runReset({ outputDir: "/out", promptFn });
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("confirmation prompt: 'y' clears state", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const promptFn = vi.fn().mockResolvedValue("y");
    await runReset({ outputDir: "/out", promptFn });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/.moodle-scraper-state.json");
    spy.mockRestore();
  });

  it("--force skips confirmation prompt entirely", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const promptFn = vi.fn();
    await runReset({ outputDir: "/out", force: true, promptFn });
    expect(promptFn).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("output message says 'Sync state cleared. Files untouched.'", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true });
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("Sync state cleared");
    expect(output).toContain("Files untouched");
    spy.mockRestore();
  });

  it("--dry-run prints what would be cleared without deleting", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", dryRun: true });
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("[dry-run]");
    expect(output).toContain("state file only");
    spy.mockRestore();
  });
});

describe("msc reset --full", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({ size: 1000 });
  });

  it("--full with DELETE confirmation deletes tracked files and state", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const promptFn = vi.fn().mockResolvedValue("DELETE");
    await runReset({ outputDir: "/out", full: true, promptFn });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/.moodle-scraper-state.json");
    spy.mockRestore();
  });

  it("--full with wrong confirmation aborts without deleting", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const promptFn = vi.fn().mockResolvedValue("yes");
    await runReset({ outputDir: "/out", full: true, promptFn });
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("--full also resets config, credentials, and session", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true });
    expect(mockConfigReset).toHaveBeenCalled();
    expect(mockDeleteCredentials).toHaveBeenCalled();
    expect(mockDeleteSessionFile).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("--full --force skips DELETE prompt", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const promptFn = vi.fn();
    await runReset({ outputDir: "/out", force: true, full: true, promptFn });
    expect(promptFn).not.toHaveBeenCalled();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    spy.mockRestore();
  });

  it("--full output message contains deleted file count and course count", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true });
    const output = spy.mock.calls.flat().join("");
    expect(output).toMatch(/Deleted 1 files? across 1 course/);
    spy.mockRestore();
  });

  it("--full output message mentions credentials cleared", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true });
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("Credentials cleared");
    spy.mockRestore();
  });

  it("--full --dry-run prints file count/size without deleting", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", dryRun: true, full: true });
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("[dry-run]");
    expect(output).toContain("Would delete");
    spy.mockRestore();
  });

  it("orphaned files (status=orphan) are also deleted with --full", async () => {
    const state = makeState();
    state.courses["1"]!.sections["s1"]!.files["r1"]!.status = "orphan";
    mockLoad.mockResolvedValue(state);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    spy.mockRestore();
  });

  it("skips non-existent localPath without crashing", async () => {
    mockLoad.mockResolvedValue(makeState("/out/Course/Section/missing.pdf"));
    mockExistsSync.mockImplementation((p: string) => p !== "/out/Course/Section/missing.pdf");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(runReset({ outputDir: "/out", force: true, full: true })).resolves.not.toThrow();
    spy.mockRestore();
  });
});

describe("msc reset — sidecarPath support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({ size: 1000 });
  });

  function makeStateWithSidecar(
    localPath = "/out/Course/Section/file.pdf",
    sidecarPath = "/out/Course/Section/file.description.md",
  ) {
    return {
      version: 1,
      lastSyncAt: "2026-04-02T10:00:00.000Z",
      courses: {
        "1": {
          name: "TestCourse",
          sections: {
            s1: {
              files: {
                r1: {
                  status: "ok",
                  localPath,
                  sidecarPath,
                  url: "https://example.com/r1",
                  hash: "abc",
                  lastModified: "",
                },
              },
            },
          },
        },
      },
    };
  }

  it("--full deletes sidecarPath alongside the main file", async () => {
    mockLoad.mockResolvedValue(makeStateWithSidecar());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.description.md");
    spy.mockRestore();
  });

  it("does not crash when sidecarPath does not exist on disk", async () => {
    mockLoad.mockResolvedValue(makeStateWithSidecar());
    // Main file exists, sidecar does not
    mockExistsSync.mockImplementation((p: string) => p !== "/out/Course/Section/file.description.md");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(runReset({ outputDir: "/out", force: true, full: true })).resolves.not.toThrow();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    expect(mockUnlinkSync).not.toHaveBeenCalledWith("/out/Course/Section/file.description.md");
    spy.mockRestore();
  });

  it("--full --dry-run counts sidecar in existing paths and shows tree output", async () => {
    mockLoad.mockResolvedValue(makeStateWithSidecar());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", dryRun: true, full: true });
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("[dry-run]");
    // Should show both files in tree
    expect(output).toContain("file.pdf");
    expect(output).toContain("file.description.md");
    // Should NOT call unlinkSync
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("uses removeEmptyDirs from state.ts (not inline logic)", async () => {
    mockLoad.mockResolvedValue(makeStateWithSidecar());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true });
    expect(mockRemoveEmptyDirs).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("--full --dry-run shows tree with correct file count", async () => {
    mockLoad.mockResolvedValue(makeStateWithSidecar());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", dryRun: true, full: true });
    const output = spy.mock.calls.flat().join("");
    // 2 existing files (localPath + sidecarPath both exist by default)
    expect(output).toMatch(/\[dry-run\] Would delete 2 files.*across 1 courses? \(1 activit/);
    spy.mockRestore();
  });
});

describe("msc reset — --move-user-files (only with --full)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    mockSelectItem.mockResolvedValue("skip");
    mockCollectFiles.mockReturnValue([]);
    mockGroupUserFiles.mockReturnValue([]);
    mockStatSync.mockReturnValue({ size: 1000 });
  });

  it("when no user files are detected, skips move flow", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue([]);
    mockGroupUserFiles.mockReturnValue([]);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true, moveUserFiles: true });
    expect(mockSelectItem).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("calls selectItem once per user file group", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue([join("/out", "MyGuide", "a.md"), join("/out", "notes.txt")]);
    mockGroupUserFiles.mockReturnValue([
      { displayPath: "MyGuide", absPath: join("/out", "MyGuide"), files: [join("/out", "MyGuide", "a.md")], isDirectory: true },
      { displayPath: "notes.txt", absPath: join("/out", "notes.txt"), files: [join("/out", "notes.txt")], isDirectory: false },
    ]);
    mockSelectItem.mockResolvedValue("skip");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true, moveUserFiles: true });
    expect(mockSelectItem).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("moves group to outputDir root when user selects 'output-root'", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue([join("/out", "MyGuide", "a.md")]);
    mockGroupUserFiles.mockReturnValue([
      { displayPath: "MyGuide", absPath: join("/out", "MyGuide"), files: [join("/out", "MyGuide", "a.md")], isDirectory: true },
    ]);
    mockSelectItem.mockResolvedValue("output-root");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true, moveUserFiles: true });
    // mkdirSync should be called for the target, renameSync should move the group
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockRenameSync).toHaveBeenCalledWith(join("/out", "MyGuide"), join("/out", "MyGuide"));
    spy.mockRestore();
  });

  it("skips move when user selects 'skip'", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue([join("/out", "MyGuide", "a.md")]);
    mockGroupUserFiles.mockReturnValue([
      { displayPath: "MyGuide", absPath: join("/out", "MyGuide"), files: [join("/out", "MyGuide", "a.md")], isDirectory: true },
    ]);
    mockSelectItem.mockResolvedValue("skip");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true, moveUserFiles: true });
    expect(mockRenameSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reports how many groups were moved vs skipped", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue([join("/out", "A", "a.md"), join("/out", "B", "b.md")]);
    mockGroupUserFiles.mockReturnValue([
      { displayPath: "A", absPath: join("/out", "A"), files: [join("/out", "A", "a.md")], isDirectory: true },
      { displayPath: "B", absPath: join("/out", "B"), files: [join("/out", "B", "b.md")], isDirectory: true },
    ]);
    mockSelectItem
      .mockResolvedValueOnce("output-root")
      .mockResolvedValueOnce("skip");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true, moveUserFiles: true });
    const output = spy.mock.calls.flat().join("");
    expect(output).toMatch(/Moved 1.*skip/i);
    spy.mockRestore();
  });

  it("--dry-run with --move-user-files shows dry-run output (move flow skipped in dry-run)", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue(["/out/MyGuide/a.md"]);
    mockGroupUserFiles.mockReturnValue([
      { displayPath: "MyGuide", absPath: "/out/MyGuide", files: ["/out/MyGuide/a.md"], isDirectory: true },
    ]);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", dryRun: true, full: true, moveUserFiles: true });
    const output = spy.mock.calls.flat().join("");
    // dry-run exits before the move flow
    expect(output).toContain("[dry-run]");
    expect(mockRenameSync).not.toHaveBeenCalled();
    expect(mockSelectItem).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("msc reset — submissionPaths support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({ size: 1000 });
  });

  function makeStateWithSubmissions(
    localPath = "/out/Course/Section/Hausarbeit.md",
    submissionPaths = [
      "/out/Course/Section/Hausarbeit.submission.pdf",
      "/out/Course/Section/Hausarbeit.submission.zip",
    ],
  ) {
    return {
      version: 1,
      lastSyncAt: "2026-04-02T10:00:00.000Z",
      courses: {
        "1": {
          name: "TestCourse",
          sections: {
            s1: {
              files: {
                r1: {
                  status: "ok",
                  localPath,
                  submissionPaths,
                  url: "https://example.com/r1",
                  hash: "abc",
                  lastModified: "",
                },
              },
            },
          },
        },
      },
    };
  }

  it("--full deletes all submissionPaths alongside the main file", async () => {
    mockLoad.mockResolvedValue(makeStateWithSubmissions());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/Hausarbeit.md");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/Hausarbeit.submission.pdf");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/Hausarbeit.submission.zip");
    spy.mockRestore();
  });

  it("does not crash when a submissionPath does not exist on disk", async () => {
    mockLoad.mockResolvedValue(
      makeStateWithSubmissions("/out/Course/Section/Hausarbeit.md", [
        "/out/Course/Section/Hausarbeit.submission.pdf",
      ]),
    );
    mockExistsSync.mockImplementation(
      (p: string) => p !== "/out/Course/Section/Hausarbeit.submission.pdf",
    );
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(runReset({ outputDir: "/out", force: true, full: true })).resolves.not.toThrow();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/Hausarbeit.md");
    expect(mockUnlinkSync).not.toHaveBeenCalledWith(
      "/out/Course/Section/Hausarbeit.submission.pdf",
    );
    spy.mockRestore();
  });

  it("--full --dry-run counts submission files and shows them in tree output", async () => {
    mockLoad.mockResolvedValue(makeStateWithSubmissions());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", dryRun: true, full: true });
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("[dry-run]");
    expect(output).toContain("Hausarbeit.submission.pdf");
    expect(output).toContain("Hausarbeit.submission.zip");
    // 3 files: main + 2 submissions
    expect(output).toMatch(/\[dry-run\] Would delete 3 files.*across 1 courses? \(1 activit/);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("works correctly when submissionPaths is absent (undefined)", async () => {
    const state = makeStateWithSubmissions();
    // Remove submissionPaths entirely
    delete (state.courses["1"]!.sections["s1"]!.files["r1"] as Record<string, unknown>)["submissionPaths"];
    mockLoad.mockResolvedValue(state);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(runReset({ outputDir: "/out", force: true, full: true })).resolves.not.toThrow();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/Hausarbeit.md");
    spy.mockRestore();
  });
});

describe("msc reset — duplicate localPath deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({ size: 1000 });
  });

  it("--full does not call unlinkSync twice for the same path when state has duplicates", async () => {
    // Two file entries with the same localPath (duplicate state bug)
    const state = {
      version: 1,
      lastSyncAt: "2026-04-02T10:00:00.000Z",
      courses: {
        "1": {
          name: "TestCourse",
          sections: {
            s1: {
              files: {
                r1: { status: "ok", localPath: "/out/Course/file.java", url: "u1", hash: "a", lastModified: "" },
                r2: { status: "ok", localPath: "/out/Course/file.java", url: "u2", hash: "a", lastModified: "" },
              },
            },
          },
        },
      },
    };
    mockLoad.mockResolvedValue(state);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true });
    // unlinkSync should only be called once for the deduplicated path (+ once for state file)
    const unlinkCalls = mockUnlinkSync.mock.calls.filter(
      (args) => args[0] === "/out/Course/file.java",
    );
    expect(unlinkCalls).toHaveLength(1);
    spy.mockRestore();
  });
});

describe("msc reset — granular flags (--state / --files / --config / --credentials)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({ size: 1000 });
  });

  // --state: deletes state only (same as old default / no flags)
  it("--state deletes state file only, not tracked files", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, state: true });
    expect(mockUnlinkSync).not.toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/.moodle-scraper-state.json");
    spy.mockRestore();
  });

  it("--state does NOT call config.reset or deleteCredentials", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, state: true });
    expect(mockConfigReset).not.toHaveBeenCalled();
    expect(mockDeleteCredentials).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // --files: deletes tracked files + state, but NOT config/credentials
  it("--files deletes tracked files and state", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, files: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/.moodle-scraper-state.json");
    spy.mockRestore();
  });

  it("--files does NOT reset config or credentials", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, files: true });
    expect(mockConfigReset).not.toHaveBeenCalled();
    expect(mockDeleteCredentials).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // --config: clears config only
  it("--config resets config only, does not delete state or tracked files", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, config: true });
    expect(mockConfigReset).toHaveBeenCalled();
    expect(mockUnlinkSync).not.toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    // State file NOT deleted when only --config
    expect(mockUnlinkSync).not.toHaveBeenCalledWith("/out/.moodle-scraper-state.json");
    spy.mockRestore();
  });

  // --credentials: clears credentials only
  it("--credentials clears keychain + session, does not delete state or tracked files", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, credentials: true });
    expect(mockDeleteCredentials).toHaveBeenCalled();
    expect(mockDeleteSessionFile).toHaveBeenCalled();
    expect(mockUnlinkSync).not.toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    expect(mockUnlinkSync).not.toHaveBeenCalledWith("/out/.moodle-scraper-state.json");
    spy.mockRestore();
  });

  // Composing --files --config --credentials = old --full behaviour
  it("--files --config --credentials behaves identically to old --full", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, files: true, config: true, credentials: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/.moodle-scraper-state.json");
    expect(mockConfigReset).toHaveBeenCalled();
    expect(mockDeleteCredentials).toHaveBeenCalled();
    expect(mockDeleteSessionFile).toHaveBeenCalled();
    spy.mockRestore();
  });

  // --full hidden alias = --files --config --credentials
  it("--full alias still works identically to --files --config --credentials", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    expect(mockConfigReset).toHaveBeenCalled();
    expect(mockDeleteCredentials).toHaveBeenCalled();
    spy.mockRestore();
  });
});
