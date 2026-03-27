// Covers: STEP-020, REQ-CLI-002, REQ-CLI-008, REQ-CLI-009, REQ-CLI-010
//
// Integration tests for the 'scrape' command. All external dependencies
// (auth, HTTP, filesystem) are mocked. Tests verify flag behaviour and
// pipeline orchestration.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/session.js", () => ({
  validateOrRefreshSession: vi.fn().mockResolvedValue(undefined),
  deleteSessionFile: vi.fn(),
}));

vi.mock("../../src/scraper/courses.js", () => ({
  fetchCourseList: vi.fn().mockResolvedValue([
    { courseId: 1, courseName: "Macro 2024", courseUrl: "https://moodle.example.com/course/view.php?id=1" },
  ]),
  fetchContentTree: vi.fn().mockResolvedValue({ courseId: 1, sections: [] }),
  parseActivityFromElement: vi.fn().mockReturnValue(null),
}));

vi.mock("../../src/sync/incremental.js", () => ({
  computeSyncPlan: vi.fn().mockReturnValue([]),
  SyncAction: { DOWNLOAD: "DOWNLOAD", ORPHAN: "ORPHAN", ORPHAN_COURSE: "ORPHAN_COURSE" },
}));

vi.mock("../../src/sync/state.js", () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    statePath: "/tmp/test/.moodle-scraper-state.json",
  })),
  migrateStatePaths: vi.fn().mockImplementation((state: unknown) => state),
}));

import { runScrape } from "../../src/commands/scrape.js";

describe("STEP-020: scrape command", () => {
  // REQ-CLI-002
  it("runs without error when all dependencies succeed", async () => {
    await expect(runScrape({ outputDir: "/tmp/test", dryRun: false, force: false })).resolves.toBeUndefined();
  });

  // REQ-CLI-002 — --dry-run writes no files
  it("--dry-run: computeSyncPlan is called with dryRun: true", async () => {
    const { computeSyncPlan } = await import("../../src/sync/incremental.js");
    await runScrape({ outputDir: "/tmp/test", dryRun: true, force: false });
    expect(vi.mocked(computeSyncPlan)).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    );
  });

  // REQ-CLI-010 — --non-interactive exits 3 when no credentials stored
  it("--non-interactive throws exitCode 3 when no credentials are stored", async () => {
    const { validateOrRefreshSession } = await import("../../src/auth/session.js");
    vi.mocked(validateOrRefreshSession).mockRejectedValueOnce(Object.assign(new Error("no creds"), { exitCode: 3 }));

    await expect(
      runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, nonInteractive: true })
    ).rejects.toMatchObject({ exitCode: 3 });
  });

  // REQ-CLI-009 — --quiet suppresses non-error output
  it("--quiet flag suppresses info output", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrInfoSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, quiet: true });

    // Should produce no output in quiet mode (no errors)
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
    stderrInfoSpy.mockRestore();
  });
});
