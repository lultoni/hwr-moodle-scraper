// Tests for msc clean command — delete or move user-added files

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- fs mocks ---
const mockUnlinkSync = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(true);
const mockMkdirSync = vi.fn();
const mockRenameSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
}));

// --- collect mock ---
const mockCollectFiles = vi.fn().mockReturnValue([]);
const mockBuildKnownPaths = vi.fn().mockReturnValue([]);
vi.mock("../../src/fs/collect.js", () => ({
  collectFiles: (...args: unknown[]) => mockCollectFiles(...args),
  buildKnownPaths: (...args: unknown[]) => mockBuildKnownPaths(...args),
  renderTree: (paths: string[], rootDir: string) => {
    const { relative } = require("node:path");
    return paths.map((p: string) => relative(rootDir, p)).join("\n");
  },
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

import { runClean } from "../../src/commands/clean.js";

function makeState() {
  return {
    version: 1,
    lastSyncAt: "2026-04-09T10:00:00.000Z",
    courses: {
      "1": {
        name: "TestCourse",
        sections: {
          s1: {
            files: {
              r1: { status: "ok", localPath: "/out/Course/Section/file.pdf", url: "https://example.com/r1", hash: "abc", lastModified: "" },
            },
          },
        },
      },
    },
  };
}

describe("msc clean", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it("prints message when no sync history exists", async () => {
    mockLoad.mockResolvedValue(null);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runClean({ outputDir: "/out", force: true });
    expect(spy.mock.calls.flat().join("")).toContain("No sync history");
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("prints message when no user-added files exist", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockBuildKnownPaths.mockReturnValue(["/out/Course/Section/file.pdf"]);
    mockCollectFiles.mockReturnValue(["/out/Course/Section/file.pdf"]);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runClean({ outputDir: "/out", force: true });
    expect(spy.mock.calls.flat().join("")).toContain("No user-added files found");
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("deletes user-added files with --force (no prompt)", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockBuildKnownPaths.mockReturnValue(["/out/Course/Section/file.pdf"]);
    mockCollectFiles.mockReturnValue([
      "/out/Course/Section/file.pdf",
      "/out/Course/Section/my-notes.txt",
      "/out/Course/orphan.pdf",
    ]);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runClean({ outputDir: "/out", force: true });
    expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/Section/my-notes.txt");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/orphan.pdf");
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("Deleted 2 files");
    spy.mockRestore();
  });

  it("cleans empty directories after deletion", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockBuildKnownPaths.mockReturnValue(["/out/Course/Section/file.pdf"]);
    mockCollectFiles.mockReturnValue([
      "/out/Course/Section/file.pdf",
      "/out/Course/orphan.pdf",
    ]);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runClean({ outputDir: "/out", force: true });
    expect(mockRemoveEmptyDirs).toHaveBeenCalledWith("/out/Course", "/out");
    spy.mockRestore();
  });

  it("--move moves files to 'User Files/' preserving relative paths", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockBuildKnownPaths.mockReturnValue(["/out/Course/Section/file.pdf"]);
    mockCollectFiles.mockReturnValue([
      "/out/Course/Section/file.pdf",
      "/out/Course/Section/my-notes.txt",
    ]);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runClean({ outputDir: "/out", move: true, force: true });
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).toHaveBeenCalledWith("/out/User Files/Course/Section", { recursive: true });
    expect(mockRenameSync).toHaveBeenCalledWith(
      "/out/Course/Section/my-notes.txt",
      "/out/User Files/Course/Section/my-notes.txt",
    );
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain('Moved 1 file to "User Files/"');
    spy.mockRestore();
  });

  it("--dry-run shows files without deleting", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockBuildKnownPaths.mockReturnValue(["/out/Course/Section/file.pdf"]);
    mockCollectFiles.mockReturnValue([
      "/out/Course/Section/file.pdf",
      "/out/Course/orphan.pdf",
    ]);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runClean({ outputDir: "/out", dryRun: true });
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("[dry-run]");
    expect(output).toContain("Would delete 1 file");
    spy.mockRestore();
  });

  it("--dry-run --move shows move preview", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockBuildKnownPaths.mockReturnValue(["/out/Course/Section/file.pdf"]);
    mockCollectFiles.mockReturnValue([
      "/out/Course/Section/file.pdf",
      "/out/Course/orphan.pdf",
    ]);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runClean({ outputDir: "/out", move: true, dryRun: true });
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockRenameSync).not.toHaveBeenCalled();
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("[dry-run]");
    expect(output).toContain('Would move 1 file to "User Files/"');
    spy.mockRestore();
  });

  it("asks for confirmation when promptFn is provided (and cancels on 'n')", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockBuildKnownPaths.mockReturnValue(["/out/Course/Section/file.pdf"]);
    mockCollectFiles.mockReturnValue([
      "/out/Course/Section/file.pdf",
      "/out/Course/orphan.pdf",
    ]);
    const mockPrompt = vi.fn().mockResolvedValue("n");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runClean({ outputDir: "/out", promptFn: mockPrompt });
    expect(mockPrompt).toHaveBeenCalledOnce();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    const output = spy.mock.calls.flat().join("");
    expect(output).toContain("Cancelled");
    spy.mockRestore();
  });

  it("proceeds with deletion when user confirms 'y'", async () => {
    mockLoad.mockResolvedValue(makeState());
    mockBuildKnownPaths.mockReturnValue(["/out/Course/Section/file.pdf"]);
    mockCollectFiles.mockReturnValue([
      "/out/Course/Section/file.pdf",
      "/out/Course/orphan.pdf",
    ]);
    const mockPrompt = vi.fn().mockResolvedValue("y");
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runClean({ outputDir: "/out", promptFn: mockPrompt });
    expect(mockUnlinkSync).toHaveBeenCalledWith("/out/Course/orphan.pdf");
    spy.mockRestore();
  });
});
