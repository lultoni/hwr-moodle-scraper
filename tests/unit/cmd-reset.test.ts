// Covers: msc reset command

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- fs mocks ---
const mockUnlinkSync = vi.fn();
const mockRmdirSync = vi.fn();
const mockReaddirSync = vi.fn().mockReturnValue([]);
const mockExistsSync = vi.fn().mockReturnValue(true);

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  rmdirSync: (...args: unknown[]) => mockRmdirSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

// --- StateManager mock ---
const mockLoad = vi.fn();
vi.mock("../../src/sync/state.js", () => ({
  StateManager: vi.fn().mockImplementation((outputDir: string) => ({
    load: mockLoad,
    statePath: `${outputDir}/.moodle-scraper-state.json`,
  })),
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
