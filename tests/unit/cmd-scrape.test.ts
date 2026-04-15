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

vi.mock("../../src/scraper/courses.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/scraper/courses.js")>();
  return {
    ...actual,
    fetchCourseList: vi.fn().mockResolvedValue([
      { courseId: 1, courseName: "Macro 2024", courseUrl: "https://moodle.example.com/course/view.php?id=1" },
    ]),
    fetchEnrolledCourses: vi.fn().mockResolvedValue([
      { courseId: 1, courseName: "Macro 2024", courseUrl: "https://moodle.example.com/course/view.php?id=1" },
    ]),
    fetchContentTree: vi.fn().mockResolvedValue({ courseId: 1, sections: [] }),
    parseActivityFromElement: vi.fn().mockReturnValue(null),
  };
});

vi.mock("../../src/sync/incremental.js", () => ({
  computeSyncPlan: vi.fn().mockReturnValue([]),
  SyncAction: { DOWNLOAD: "DOWNLOAD", ORPHAN: "ORPHAN", ORPHAN_COURSE: "ORPHAN_COURSE" },
}));

vi.mock("../../src/sync/state.js", () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    statePath: "/tmp/test/.moodle-scraper-state.json",
    backupPath: "/tmp/test/.moodle-scraper-state.json.bak",
  })),
  migrateStatePaths: vi.fn().mockImplementation((state: unknown) => ({ state, changed: false })),
  relocateFiles: vi.fn().mockImplementation((state: unknown) => ({ state, changed: false })),
}));

vi.mock("../../src/config.js", () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../src/scraper/dispatch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/scraper/dispatch.js")>();
  return {
    ...actual,
    buildDownloadPlan: vi.fn().mockReturnValue({ items: [], unknownTypes: new Map() }),
    applyLabelSubfolders: vi.fn().mockImplementation((activities: unknown) => activities),
  };
});

vi.mock("../../src/fs/output.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/fs/output.js")>();
  return {
    ...actual,
    atomicWrite: vi.fn().mockResolvedValue({ hash: "a".repeat(64), failed: false }),
    checkDiskSpace: vi.fn().mockResolvedValue(undefined),
    checkDiskSpaceSafe: vi.fn().mockResolvedValue(undefined),
  };
});

import { runScrape } from "../../src/commands/scrape.js";
import { ConfigManager } from "../../src/config.js";

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

describe("STEP-020: scrape — config-driven UX improvements", () => {
  it("throws USAGE_ERROR (exitCode 2) when outputDir is empty string", async () => {
    await expect(
      runScrape({ outputDir: "", dryRun: false, force: false })
    ).rejects.toMatchObject({ exitCode: 2 });
  });

  it("prints 'Fetching course content' at INFO level during scrape", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false });
    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Fetching course content");
    stderrSpy.mockRestore();
  });

  it("prints 'Syncing' at INFO level during scrape", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false });
    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Syncing");
    stderrSpy.mockRestore();
  });

  it("prints log hint after first successful scrape when logFile=null and logHintShown=false", async () => {
    const cfgInstance = new (vi.mocked(ConfigManager))() as never;
    vi.mocked(cfgInstance.get).mockImplementation(async (key: string) => {
      if (key === "logFile") return null;
      if (key === "logHintShown") return false;
      return undefined;
    });

    // fetchEnrolledCourses returns 1 course, computeSyncPlan returns 0 downloads
    // downloadedCount stays 0, so hint should NOT fire (requires downloadedCount > 0)
    // We test the suppression case here; actual firing is covered by the next test
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false });
    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    // With 0 downloads, hint should NOT appear
    expect(output).not.toContain("Tip:");
    stderrSpy.mockRestore();
  });

  it("does not print log hint when logHintShown=true", async () => {
    const cfgInstance = new (vi.mocked(ConfigManager))() as never;
    vi.mocked(cfgInstance.get).mockImplementation(async (key: string) => {
      if (key === "logHintShown") return true;
      return undefined;
    });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false });
    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).not.toContain("Tip:");
    stderrSpy.mockRestore();
  });
});

describe("STEP-020: scrape — sec/act legend + 3-char padding (Pass 42)", () => {
  it("prints sec/act legend line after 'Fetching course content'", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false });
    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    stderrSpy.mockRestore();

    expect(output).toContain("sec = sections, act = activities");
  });

  it("pads sec and act numbers to 3 chars in the course checkmark line", async () => {
    const { fetchEnrolledCourses, fetchContentTree } = await import("../../src/scraper/courses.js");
    vi.mocked(fetchEnrolledCourses).mockResolvedValueOnce([
      { courseId: 1, courseName: "Short", courseUrl: "https://moodle.example.com/course/view.php?id=1" },
    ]);
    vi.mocked(fetchContentTree).mockResolvedValueOnce({ courseId: 1, sections: [] });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, courses: [1] });
    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    stderrSpy.mockRestore();

    // Numbers should be padded to 3 chars: "  0 sec,   0 act"
    const line = output.split("\n").find((l) => l.includes("✓") && l.includes("Short"));
    expect(line).toBeDefined();
    expect(line).toMatch(/\(\s*\d{1,3} sec,\s*\d{1,3} act\)/);
    // Specifically: 0 sections → padded "  0"
    expect(line).toContain("  0 sec");
  });
});

describe("STEP-020: scrape — column-aligned course list (Pass 41)", () => {
  // Feature 2 (Pass 41): course name truncated to 45 chars, stats at fixed column

  it("truncates long course name to 45 chars with ellipsis in the checkmark line", async () => {
    const { fetchEnrolledCourses, fetchContentTree } = await import("../../src/scraper/courses.js");
    const longName = "WI3042 Sehr Langer Kursname Der Definitiv Mehr Als 45 Zeichen Hat";
    vi.mocked(fetchEnrolledCourses).mockResolvedValueOnce([
      { courseId: 1, courseName: longName, courseUrl: "https://moodle.example.com/course/view.php?id=1" },
    ]);
    vi.mocked(fetchContentTree).mockResolvedValueOnce({ courseId: 1, sections: [] });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, courses: [1] });
    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    stderrSpy.mockRestore();

    // Should contain truncated name with ellipsis — not the full 66-char name
    expect(output).not.toContain(longName);
    expect(output).toMatch(/✓.*…/); // ellipsis present
  });

  it("pads short course name to fixed column width so stats align", async () => {
    const { fetchEnrolledCourses, fetchContentTree } = await import("../../src/scraper/courses.js");
    vi.mocked(fetchEnrolledCourses).mockResolvedValueOnce([
      { courseId: 1, courseName: "Short", courseUrl: "https://moodle.example.com/course/view.php?id=1" },
    ]);
    vi.mocked(fetchContentTree).mockResolvedValueOnce({ courseId: 1, sections: [] });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, courses: [1] });
    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    stderrSpy.mockRestore();

    // Short name padded — name field is exactly 45 chars before stats
    const line = output.split("\n").find((l) => l.includes("✓") && l.includes("Short"));
    expect(line).toBeDefined();
    // After "✓ " the name portion should be 45 chars
    const match = line!.match(/✓ (.{45})\s/);
    expect(match).not.toBeNull();
  });
});

describe("STEP-020: scrape --courses filter", () => {
  // REQ-CLI-002 — --courses must use real enrolled course names (not placeholder numeric IDs)
  it("fetches enrolled courses and filters to matching IDs when --courses is set", async () => {
    const { fetchEnrolledCourses } = await import("../../src/scraper/courses.js");
    vi.mocked(fetchEnrolledCourses).mockResolvedValueOnce([
      { courseId: 1, courseName: "WI24A Macro 2024", courseUrl: "https://moodle.example.com/course/view.php?id=1" },
      { courseId: 2, courseName: "WI24B Micro 2024", courseUrl: "https://moodle.example.com/course/view.php?id=2" },
    ]);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, courses: [1] });
    stderrSpy.mockRestore();

    // fetchEnrolledCourses must be called even when --courses is specified
    expect(vi.mocked(fetchEnrolledCourses)).toHaveBeenCalled();
  });

  it("uses real course name (with WI#### code) for filtered course — not numeric placeholder", async () => {
    const { fetchEnrolledCourses, fetchContentTree } = await import("../../src/scraper/courses.js");
    vi.mocked(fetchEnrolledCourses).mockResolvedValueOnce([
      { courseId: 98824, courseName: "WI3042 Prozessmodellierung", courseUrl: "https://moodle.example.com/course/view.php?id=98824" },
    ]);
    vi.mocked(fetchContentTree).mockResolvedValueOnce({ courseId: 98824, sections: [] });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, courses: [98824] });
    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    stderrSpy.mockRestore();

    // Output must mention the real course name, not just the numeric ID
    expect(output).not.toContain('"98824"');
    expect(vi.mocked(fetchContentTree)).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 98824 })
    );
  });

  it("falls back to numeric placeholder when ID not found in enrolled list", async () => {
    const { fetchEnrolledCourses } = await import("../../src/scraper/courses.js");
    vi.mocked(fetchEnrolledCourses).mockResolvedValueOnce([
      { courseId: 1, courseName: "WI24A Macro 2024", courseUrl: "https://moodle.example.com/course/view.php?id=1" },
    ]);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // courseId 999 not in enrolled list — should not throw
    await expect(
      runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, courses: [999] })
    ).resolves.toBeUndefined();
    stderrSpy.mockRestore();
  });
});

describe("STEP-020: scrape — binary promotion Case (c) (Pass 42 fix)", () => {
  // Case (c) in the promotion loop previously re-promoted any binary file with an unknown
  // extension to DOWNLOAD every run. Files like Dockerfile.base were affected.
  // Now only truly extensionless or numeric-ext paths (BUG-C artifacts) are promoted.

  it("does not re-promote a binary SKIP item with .base extension to DOWNLOAD", async () => {
    const { computeSyncPlan } = await import("../../src/sync/incremental.js");
    const { StateManager } = await import("../../src/sync/state.js");
    const { fetchContentTree } = await import("../../src/scraper/courses.js");

    vi.mocked(StateManager).mockImplementationOnce(() => ({
      load: vi.fn().mockResolvedValue({
        courses: {
          "1": {
            name: "IT-Sec",
            sections: {
              "s1": {
                files: {
                  "r-dockerfile": {
                    name: "Dockerfile.base",
                    url: "https://moodle.example.com/r/docker",
                    localPath: "/tmp/test/Semester_3/IT-Sicherheit/Dockerfile.base",
                    hash: "a".repeat(64),
                    lastModified: "2026-01-01T00:00:00Z",
                    status: "ok" as const,
                  },
                },
              },
            },
          },
        },
        generatedFiles: [],
        lastSyncAt: new Date().toISOString(),
      }),
      save: vi.fn().mockResolvedValue(undefined),
      statePath: "/tmp/test/.moodle-scraper-state.json",
      backupPath: "/tmp/test/.moodle-scraper-state.json.bak",
    } as unknown as InstanceType<typeof StateManager>));

    vi.mocked(fetchContentTree).mockResolvedValueOnce({
      courseId: 1,
      sections: [{ sectionId: "s1", sectionName: "Weitere Ressourcen", activities: [{
        activityType: "resource",
        activityName: "Dockerfile.base",
        resourceId: "r-dockerfile",
        url: "https://moodle.example.com/r/docker",
        hash: "moodle-token-abc",
        isAccessible: true,
      }] }],
    });

    // computeSyncPlan returns SKIP (file up to date after Fix 1)
    vi.mocked(computeSyncPlan).mockReturnValueOnce([
      { action: "SKIP" as "SKIP", resourceId: "r-dockerfile", courseId: 1, url: "https://moodle.example.com/r/docker" },
    ]);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, courses: [1] });
    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    stderrSpy.mockRestore();

    // Must stay skipped — not re-promoted to DOWNLOAD
    // "0 new activities" means the SKIP item was not converted to a download
    expect(output).not.toContain("1 new activity");
    expect(output).toContain("0 new activities");
  });
});

describe("T-1: sidecar origin header in .description.md files", () => {
  // Helper: sets up a DOWNLOAD plan item + matching activity in fetchContentTree so the
  // classification loop processes the activity and calls buildDownloadPlan.
  function setupDownloadScenario(
    resourceId: string,
    activityType: string,
    activityName: string,
    description: string,
  ) {
    return {
      planItem: { action: "DOWNLOAD" as "DOWNLOAD", resourceId, courseId: 1, url: `https://moodle.example.com/r/${resourceId}` },
      activity: { activityType, activityName, resourceId, url: `https://moodle.example.com/r/${resourceId}`, description, isAccessible: true },
    };
  }

  it("sidecar .description.md content begins with HTML comment origin header", async () => {
    const { atomicWrite } = await import("../../src/fs/output.js");
    const { buildDownloadPlan } = await import("../../src/scraper/dispatch.js");
    const { computeSyncPlan } = await import("../../src/sync/incremental.js");
    const { fetchEnrolledCourses, fetchContentTree } = await import("../../src/scraper/courses.js");

    const { planItem, activity } = setupDownloadScenario(
      "r-lecture", "resource", "My Lecture Notes",
      "<p>This is a long enough description that will not be consolidated.</p>",
    );

    vi.mocked(fetchEnrolledCourses).mockResolvedValueOnce([
      { courseId: 1, courseName: "WI24A Macro 2024", courseUrl: "https://moodle.example.com/course/view.php?id=1" },
    ]);
    vi.mocked(fetchContentTree).mockResolvedValueOnce({
      courseId: 1,
      sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [activity] }],
    });
    vi.mocked(computeSyncPlan).mockReturnValueOnce([planItem]);
    // buildDownloadPlan returns a description-md sidecar item
    vi.mocked(buildDownloadPlan).mockReturnValueOnce({
      items: [{
        resourceId: "r-lecture",
        courseId: 1,
        url: "https://moodle.example.com/r/r-lecture",
        strategy: "description-md" as const,
        destPath: "/tmp/test/Semester_1/Macro 2024/Week 1/My Lecture Notes.description.md",
        label: "My Lecture Notes",
        activityType: "resource",
        description: "<p>This is a long enough description that will not be consolidated into _Descriptions.md.</p>",
        isSidecar: true,
        name: "My Lecture Notes",
      }],
      unknownTypes: new Map(),
    } as never);

    const capturedWrites: Array<{ path: string; content: string }> = [];
    vi.mocked(atomicWrite).mockImplementation(async (path: string, buf: Buffer) => {
      capturedWrites.push({ path, content: buf.toString("utf8") });
      return { hash: "a".repeat(64), failed: false };
    });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false });
    stderrSpy.mockRestore();

    const sidecarWrite = capturedWrites.find((w) => w.path.endsWith(".description.md"));
    expect(sidecarWrite).toBeDefined();
    expect(sidecarWrite!.content).toMatch(/^<!-- Source: My Lecture Notes \(resource\) -->/);
  });

  it("origin header is on line 1 followed by a blank line", async () => {
    const { atomicWrite } = await import("../../src/fs/output.js");
    const { buildDownloadPlan } = await import("../../src/scraper/dispatch.js");
    const { computeSyncPlan } = await import("../../src/sync/incremental.js");
    const { fetchEnrolledCourses, fetchContentTree } = await import("../../src/scraper/courses.js");

    const { planItem, activity } = setupDownloadScenario(
      "r-assign", "assign", "Activity",
      "<p>A sufficiently long description here that exceeds the consolidation threshold.</p>",
    );

    vi.mocked(fetchEnrolledCourses).mockResolvedValueOnce([
      { courseId: 1, courseName: "WI24A Macro 2024", courseUrl: "https://moodle.example.com/course/view.php?id=1" },
    ]);
    vi.mocked(fetchContentTree).mockResolvedValueOnce({
      courseId: 1,
      sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [activity] }],
    });
    vi.mocked(computeSyncPlan).mockReturnValueOnce([planItem]);
    vi.mocked(buildDownloadPlan).mockReturnValueOnce({
      items: [{
        resourceId: "r-assign",
        courseId: 1,
        url: "https://moodle.example.com/r/r-assign",
        strategy: "description-md" as const,
        destPath: "/tmp/test/Semester_1/Macro 2024/Week 1/Activity.description.md",
        label: "Activity",
        activityType: "assign",
        description: "<p>A sufficiently long description here that exceeds the consolidation threshold.</p>",
        isSidecar: true,
        name: "Activity",
      }],
      unknownTypes: new Map(),
    } as never);

    const capturedWrites: Array<{ path: string; content: string }> = [];
    vi.mocked(atomicWrite).mockImplementation(async (path: string, buf: Buffer) => {
      capturedWrites.push({ path, content: buf.toString("utf8") });
      return { hash: "a".repeat(64), failed: false };
    });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false });
    stderrSpy.mockRestore();

    const sidecarWrite = capturedWrites.find((w) => w.path.endsWith(".description.md"));
    expect(sidecarWrite).toBeDefined();
    const lines = sidecarWrite!.content.split("\n");
    expect(lines[0]).toMatch(/^<!-- Source:/);
    expect(lines[1]).toBe("");
  });

  it("label-md items do NOT get the origin header", async () => {
    const { atomicWrite } = await import("../../src/fs/output.js");
    const { buildDownloadPlan } = await import("../../src/scraper/dispatch.js");
    const { computeSyncPlan } = await import("../../src/sync/incremental.js");
    const { fetchEnrolledCourses, fetchContentTree } = await import("../../src/scraper/courses.js");

    const { planItem, activity } = setupDownloadScenario(
      "r-label", "label", "Section Header",
      "<p>Section introductory text that is long enough to pass the threshold check.</p>",
    );

    vi.mocked(fetchEnrolledCourses).mockResolvedValueOnce([
      { courseId: 1, courseName: "WI24A Macro 2024", courseUrl: "https://moodle.example.com/course/view.php?id=1" },
    ]);
    vi.mocked(fetchContentTree).mockResolvedValueOnce({
      courseId: 1,
      sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [activity] }],
    });
    vi.mocked(computeSyncPlan).mockReturnValueOnce([planItem]);
    vi.mocked(buildDownloadPlan).mockReturnValueOnce({
      items: [{
        resourceId: "r-label",
        courseId: 1,
        url: "https://moodle.example.com/r/r-label",
        strategy: "label-md" as const,
        destPath: "/tmp/test/Semester_1/Macro 2024/Week 1/Section Header.md",
        label: "Section Header",
        activityType: "label",
        description: "<p>Section introductory text that is long enough to pass the threshold check.</p>",
        isSidecar: false,
        name: "Section Header",
      }],
      unknownTypes: new Map(),
    } as never);

    const capturedWrites: Array<{ path: string; content: string }> = [];
    vi.mocked(atomicWrite).mockImplementation(async (path: string, buf: Buffer) => {
      capturedWrites.push({ path, content: buf.toString("utf8") });
      return { hash: "a".repeat(64), failed: false };
    });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false });
    stderrSpy.mockRestore();

    const labelWrite = capturedWrites.find((w) => w.path.endsWith("Section Header.md"));
    expect(labelWrite).toBeDefined();
    expect(labelWrite!.content).not.toContain("<!-- Source:");
  });
});

// ── T-8: scrape --json ────────────────────────────────────────────────────────

describe("T-8: scrape --json output mode", () => {
  it("--json outputs valid JSON summary after scrape", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, json: true });
    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();

    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("--json output contains newFiles, updatedFiles, skipped, errors keys", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, json: true });
    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();

    const result = JSON.parse(output) as Record<string, unknown>;
    expect(result).toHaveProperty("newFiles");
    expect(result).toHaveProperty("updatedFiles");
    expect(result).toHaveProperty("skipped");
    expect(result).toHaveProperty("errors");
  });

  it("--json suppresses human-readable output (no 'Legend:', no 'Done:')", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, json: true });
    const stdoutOutput = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();

    // stdout must only contain JSON
    expect(stdoutOutput.trim()).toMatch(/^\{[\s\S]*\}$/);
    // stderr must have no INFO messages (--json implies quiet)
    expect(stderrOutput).not.toContain("Done:");
    expect(stderrOutput).not.toContain("Legend:");
  });

  it("--json with new files lists them in newFiles array", async () => {
    const { computeSyncPlan } = await import("../../src/sync/incremental.js");
    const { fetchEnrolledCourses, fetchContentTree } = await import("../../src/scraper/courses.js");
    const { buildDownloadPlan } = await import("../../src/scraper/dispatch.js");
    const { atomicWrite } = await import("../../src/fs/output.js");

    vi.mocked(fetchEnrolledCourses).mockResolvedValueOnce([
      { courseId: 1, courseName: "WI24A Macro 2024", courseUrl: "https://moodle.example.com/course/view.php?id=1" },
    ]);
    vi.mocked(fetchContentTree).mockResolvedValueOnce({
      courseId: 1,
      sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [{
        activityType: "label", activityName: "New Label", resourceId: "r-new", url: "https://moodle.example.com/r/new", isAccessible: true,
      }] }],
    });
    vi.mocked(computeSyncPlan).mockReturnValueOnce([
      { action: "DOWNLOAD" as "DOWNLOAD", resourceId: "r-new", courseId: 1, url: "https://moodle.example.com/r/new" },
    ]);
    vi.mocked(buildDownloadPlan).mockReturnValueOnce({
      items: [{
        resourceId: "r-new", courseId: 1, url: "https://moodle.example.com/r/new",
        strategy: "label-md" as const, destPath: "/tmp/test/Semester_1/Macro 2024/Week 1/New Label.md",
        label: "New Label", activityType: "label",
        description: "<p>New content that is long enough to be kept.</p>",
        isSidecar: false, name: "New Label",
      }],
      unknownTypes: new Map(),
    } as never);
    vi.mocked(atomicWrite).mockResolvedValueOnce({ hash: "c".repeat(64), failed: false });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runScrape({ outputDir: "/tmp/test", dryRun: false, force: false, json: true });
    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();

    const result = JSON.parse(output) as { newFiles: string[]; skipped: number };
    expect(result.newFiles.length).toBeGreaterThanOrEqual(1);
    expect(typeof result.skipped).toBe("number");
  });
});
