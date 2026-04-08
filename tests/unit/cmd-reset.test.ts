// Covers: msc reset command

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- fs mocks ---
const mockUnlinkSync = vi.fn();
const mockRmdirSync = vi.fn();
const mockReaddirSync = vi.fn().mockReturnValue([]);
const mockExistsSync = vi.fn().mockReturnValue(true);
const mockMkdirSync = vi.fn();
const mockRenameSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  rmdirSync: (...args: unknown[]) => mockRmdirSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
}));

// --- collect mock ---
const mockCollectFiles = vi.fn().mockReturnValue([]);
const mockGroupUserFiles = vi.fn().mockReturnValue([]);
vi.mock("../../src/fs/collect.js", () => ({
  collectFiles: (...args: unknown[]) => mockCollectFiles(...args),
  groupUserFiles: (...args: unknown[]) => mockGroupUserFiles(...args),
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
vi.mock("../../src/auth/keychain.js", () => ({
  KeychainAdapter: vi.fn().mockImplementation(() => ({
    deleteCredentials: mockDeleteCredentials,
  })),
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

describe("msc reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
  });

  it("prints 'Nothing to reset.' and returns when no state exists", async () => {
    mockLoad.mockResolvedValue(null);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true });
    expect(spy.mock.calls.flat().join("")).toContain("Nothing to reset.");
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("default reset deletes known file and state file", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
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

  it("confirmation prompt: 'n' aborts without deleting", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const promptFn = vi.fn().mockResolvedValue("n");
    await runReset({ outputDir: "/out", promptFn });
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("confirmation prompt: 'y' proceeds with deletion", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const promptFn = vi.fn().mockResolvedValue("y");
    await runReset({ outputDir: "/out", promptFn });
    expect(mockUnlinkSync).toHaveBeenCalled();
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

  it("--full also resets config, credentials, and session", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true });
    expect(mockConfigReset).toHaveBeenCalled();
    expect(mockDeleteCredentials).toHaveBeenCalled();
    expect(mockDeleteSessionFile).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("--dry-run prints what would be deleted but does not call unlinkSync", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", dryRun: true });
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("[dry-run]");
    spy.mockRestore();
  });

  it("orphaned files (status=orphan) are also deleted", async () => {
    const state = makeState();
    state.courses["1"]!.sections["s1"]!.files["r1"]!.status = "orphan";
    mockLoad.mockResolvedValue(state);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    spy.mockRestore();
  });

  it("skips non-existent localPath without crashing", async () => {
    mockLoad.mockResolvedValue(makeState("/out/Course/Section/missing.pdf"));
    mockExistsSync.mockImplementation((p: string) => p !== "/out/Course/Section/missing.pdf");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(runReset({ outputDir: "/out", force: true })).resolves.not.toThrow();
    spy.mockRestore();
  });

  it("output message contains deleted file count and course count", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true });
    const output = spy.mock.calls.flat().join("");
    expect(output).toMatch(/Deleted 1 files? across 1 course/);
    spy.mockRestore();
  });

  it("--full output message mentions credentials cleared", async () => {
    mockLoad.mockResolvedValue(makeState());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, full: true });
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("credentials cleared");
    spy.mockRestore();
  });
});

describe("msc reset — sidecarPath support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
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

  it("deletes sidecarPath alongside the main file", async () => {
    mockLoad.mockResolvedValue(makeStateWithSidecar());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.description.md");
    spy.mockRestore();
  });

  it("does not crash when sidecarPath does not exist on disk", async () => {
    mockLoad.mockResolvedValue(makeStateWithSidecar());
    // Main file exists, sidecar does not
    mockExistsSync.mockImplementation((p: string) => p !== "/out/Course/Section/file.description.md");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(runReset({ outputDir: "/out", force: true })).resolves.not.toThrow();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/file.pdf");
    expect(mockUnlinkSync).not.toHaveBeenCalledWith("/out/Course/Section/file.description.md");
    spy.mockRestore();
  });

  it("--dry-run counts sidecar in existing paths and shows tree output", async () => {
    mockLoad.mockResolvedValue(makeStateWithSidecar());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", dryRun: true });
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
    await runReset({ outputDir: "/out", force: true });
    expect(mockRemoveEmptyDirs).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("--dry-run shows tree with correct file count", async () => {
    mockLoad.mockResolvedValue(makeStateWithSidecar());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", dryRun: true });
    const output = spy.mock.calls.flat().join("");
    // 2 existing files (localPath + sidecarPath both exist by default)
    expect(output).toMatch(/\[dry-run\] Would delete 2 files across 1 courses? \(1 activit/);
    spy.mockRestore();
  });
});

describe("msc reset — --move-user-files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    mockSelectItem.mockResolvedValue("skip");
    mockCollectFiles.mockReturnValue([]);
    mockGroupUserFiles.mockReturnValue([]);
  });

  it("when no user files are detected, skips move flow", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue([]);
    mockGroupUserFiles.mockReturnValue([]);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, moveUserFiles: true });
    expect(mockSelectItem).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("calls selectItem once per user file group", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue(["/out/MyGuide/a.md", "/out/notes.txt"]);
    mockGroupUserFiles.mockReturnValue([
      { displayPath: "MyGuide", absPath: "/out/MyGuide", files: ["/out/MyGuide/a.md"], isDirectory: true },
      { displayPath: "notes.txt", absPath: "/out/notes.txt", files: ["/out/notes.txt"], isDirectory: false },
    ]);
    mockSelectItem.mockResolvedValue("skip");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, moveUserFiles: true });
    expect(mockSelectItem).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("moves group to outputDir root when user selects 'output-root'", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue(["/out/MyGuide/a.md"]);
    mockGroupUserFiles.mockReturnValue([
      { displayPath: "MyGuide", absPath: "/out/MyGuide", files: ["/out/MyGuide/a.md"], isDirectory: true },
    ]);
    mockSelectItem.mockResolvedValue("output-root");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, moveUserFiles: true });
    // mkdirSync should be called for the target, renameSync should move the group
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockRenameSync).toHaveBeenCalledWith("/out/MyGuide", "/out/MyGuide");
    spy.mockRestore();
  });

  it("skips move when user selects 'skip'", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue(["/out/MyGuide/a.md"]);
    mockGroupUserFiles.mockReturnValue([
      { displayPath: "MyGuide", absPath: "/out/MyGuide", files: ["/out/MyGuide/a.md"], isDirectory: true },
    ]);
    mockSelectItem.mockResolvedValue("skip");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, moveUserFiles: true });
    expect(mockRenameSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reports how many groups were moved vs skipped", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue(["/out/A/a.md", "/out/B/b.md"]);
    mockGroupUserFiles.mockReturnValue([
      { displayPath: "A", absPath: "/out/A", files: ["/out/A/a.md"], isDirectory: true },
      { displayPath: "B", absPath: "/out/B", files: ["/out/B/b.md"], isDirectory: true },
    ]);
    mockSelectItem
      .mockResolvedValueOnce("output-root")
      .mockResolvedValueOnce("skip");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true, moveUserFiles: true });
    const output = spy.mock.calls.flat().join("");
    expect(output).toMatch(/Moved 1.*skip/i);
    spy.mockRestore();
  });

  it("--dry-run with --move-user-files shows user groups without moving", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockCollectFiles.mockReturnValue(["/out/MyGuide/a.md"]);
    mockGroupUserFiles.mockReturnValue([
      { displayPath: "MyGuide", absPath: "/out/MyGuide", files: ["/out/MyGuide/a.md"], isDirectory: true },
    ]);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", dryRun: true, moveUserFiles: true });
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("[dry-run]");
    expect(output).toContain("MyGuide");
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

  it("deletes all submissionPaths alongside the main file", async () => {
    mockLoad.mockResolvedValue(makeStateWithSubmissions());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", force: true });
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
    await expect(runReset({ outputDir: "/out", force: true })).resolves.not.toThrow();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/Hausarbeit.md");
    expect(mockUnlinkSync).not.toHaveBeenCalledWith(
      "/out/Course/Section/Hausarbeit.submission.pdf",
    );
    spy.mockRestore();
  });

  it("--dry-run counts submission files and shows them in tree output", async () => {
    mockLoad.mockResolvedValue(makeStateWithSubmissions());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runReset({ outputDir: "/out", dryRun: true });
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("[dry-run]");
    expect(output).toContain("Hausarbeit.submission.pdf");
    expect(output).toContain("Hausarbeit.submission.zip");
    // 3 files: main + 2 submissions
    expect(output).toMatch(/\[dry-run\] Would delete 3 files across 1 courses? \(1 activit/);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("works correctly when submissionPaths is absent (undefined)", async () => {
    const state = makeStateWithSubmissions();
    // Remove submissionPaths entirely
    delete (state.courses["1"]!.sections["s1"]!.files["r1"] as Record<string, unknown>)["submissionPaths"];
    mockLoad.mockResolvedValue(state);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(runReset({ outputDir: "/out", force: true })).resolves.not.toThrow();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/Hausarbeit.md");
    spy.mockRestore();
  });
});

describe("msc reset — duplicate localPath deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
  });

  it("does not call unlinkSync twice for the same path when state has duplicates", async () => {
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
    await runReset({ outputDir: "/out", force: true });
    // unlinkSync should only be called once for the deduplicated path (+ once for state file)
    const unlinkCalls = mockUnlinkSync.mock.calls.filter(
      (args) => args[0] === "/out/Course/file.java",
    );
    expect(unlinkCalls).toHaveLength(1);
    spy.mockRestore();
  });
});
