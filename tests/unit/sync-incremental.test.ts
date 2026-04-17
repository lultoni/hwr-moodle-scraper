// Covers: STEP-017, REQ-SYNC-003, REQ-SYNC-004, REQ-SYNC-005, REQ-SYNC-006,
//         REQ-SYNC-007, REQ-SYNC-008, REQ-SYNC-009
//
// Tests for the incremental sync engine: change detection, new/removed files,
// new/removed courses, --force, and --dry-run.
// No real HTTP or filesystem writes — state and content tree are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeSyncPlan, SyncAction } from "../../src/sync/incremental.js";

// Helpers to build test fixtures
function makeFile(id: string, hash: string) {
  return { resourceId: id, name: `file-${id}.pdf`, url: `https://moodle.example.com/r/${id}`, localPath: `/out/file-${id}.pdf`, hash, lastModified: "2026-01-01T00:00:00Z", status: "ok" as const };
}

describe("STEP-017: Incremental sync — change detection", () => {
  // REQ-SYNC-003 — no changes
  it("returns no DOWNLOAD actions when nothing has changed", () => {
    const stateFile = { courses: { "1": { name: "Macro", sections: { "s1": { files: { "r1": makeFile("r1", "aaa") } } } } } };
    const currentTree = { courseId: 1, sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [{ activityType: "resource", resourceId: "r1", name: "file-r1.pdf", url: "https://moodle.example.com/r/r1", hash: "aaa", isAccessible: true }] }] };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false });
    const downloads = plan.filter((a) => a.action === SyncAction.DOWNLOAD);
    expect(downloads).toHaveLength(0);
  });

  // REQ-SYNC-003 — changed file
  it("returns DOWNLOAD action for a file with a different hash", () => {
    const stateFile = { courses: { "1": { name: "Macro", sections: { "s1": { files: { "r1": makeFile("r1", "aaa") } } } } } };
    const currentTree = { courseId: 1, sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [{ activityType: "resource", resourceId: "r1", name: "file-r1.pdf", url: "https://moodle.example.com/r/r1", hash: "bbb", isAccessible: true }] }] };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false });
    const downloads = plan.filter((a) => a.action === SyncAction.DOWNLOAD);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.resourceId).toBe("r1");
  });

  // REQ-SYNC-004 — new file
  it("returns DOWNLOAD action for a new file not in state", () => {
    const stateFile = { courses: { "1": { name: "Macro", sections: { "s1": { files: {} } } } } };
    const currentTree = { courseId: 1, sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [{ activityType: "resource", resourceId: "r99", name: "new.pdf", url: "https://moodle.example.com/r/r99", hash: "ccc", isAccessible: true }] }] };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false });
    const downloads = plan.filter((a) => a.action === SyncAction.DOWNLOAD);
    expect(downloads[0]?.resourceId).toBe("r99");
  });

  // REQ-SYNC-005 — orphaned file
  it("returns ORPHAN action for a file in state but absent from Moodle", () => {
    const stateFile = { courses: { "1": { name: "Macro", sections: { "s1": { files: { "r1": makeFile("r1", "aaa") } } } } } };
    const currentTree = { courseId: 1, sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [] }] };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false });
    const orphans = plan.filter((a) => a.action === SyncAction.ORPHAN);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.resourceId).toBe("r1");
  });
});

describe("STEP-017: Incremental sync — courses", () => {
  // REQ-SYNC-006 — new course
  it("returns DOWNLOAD_COURSE action for a course not in state", () => {
    const stateFile = { courses: {} };
    const currentTree = { courseId: 5, sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [{ activityType: "resource", resourceId: "r1", name: "file.pdf", url: "https://moodle.example.com/r/r1", hash: "aaa", isAccessible: true }] }] };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false });
    const courseDownloads = plan.filter((a) => a.action === SyncAction.DOWNLOAD);
    expect(courseDownloads.length).toBeGreaterThan(0);
  });

  // REQ-SYNC-007 — removed course
  it("returns ORPHAN_COURSE action for a course in state but absent from Moodle", () => {
    const stateFile = { courses: { "5": { name: "Old Course", sections: {} } } };
    const currentTree: never[] = []; // empty — course no longer enrolled

    const plan = computeSyncPlan({ state: stateFile, currentTree, force: false });
    const orphanCourses = plan.filter((a) => a.action === SyncAction.ORPHAN_COURSE);
    expect(orphanCourses).toHaveLength(1);
  });
});

describe("STEP-017: --force flag", () => {
  // REQ-SYNC-008
  it("returns DOWNLOAD for all files regardless of hash match when force=true", () => {
    const stateFile = { courses: { "1": { name: "Macro", sections: { "s1": { files: { "r1": makeFile("r1", "same") } } } } } };
    const currentTree = { courseId: 1, sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [{ activityType: "resource", resourceId: "r1", name: "file-r1.pdf", url: "https://moodle.example.com/r/r1", hash: "same", isAccessible: true }] }] };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: true });
    const downloads = plan.filter((a) => a.action === SyncAction.DOWNLOAD);
    expect(downloads).toHaveLength(1); // forced re-download
  });
});

describe("STEP-017: label activity state tracking", () => {
  // Regression: label activities have url="" — state must still be saved and checked
  it("skips a label activity on second run when state entry exists (url is empty string)", () => {
    // Simulate: label was downloaded on first run and state was saved with url=""
    const stateFile = {
      courses: {
        "1": {
          name: "Course",
          sections: {
            "s1": {
              files: {
                "label-Welcome-Welcome": {
                  name: "Welcome",
                  url: "",
                  localPath: "/out/Course/s1/Welcome.md",
                  hash: "",
                  lastModified: "2026-01-01T00:00:00Z",
                  status: "ok" as const,
                },
              },
            },
          },
        },
      },
    };
    const currentTree = {
      courseId: 1,
      sections: [{
        sectionId: "s1",
        sectionName: "Week 1",
        activities: [{
          activityType: "label",
          activityName: "Welcome",
          resourceId: "label-Welcome-Welcome",
          url: "",
          hash: "",
          isAccessible: true,
        }],
      }],
    };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false });
    const downloads = plan.filter((a) => a.action === SyncAction.DOWNLOAD);
    expect(downloads).toHaveLength(0);
    const skips = plan.filter((a) => a.action === SyncAction.SKIP);
    expect(skips).toHaveLength(1);
  });

  it("downloads a label activity on first run when no state entry exists", () => {
    const stateFile = { courses: {} };
    const currentTree = {
      courseId: 1,
      sections: [{
        sectionId: "s1",
        sectionName: "Week 1",
        activities: [{
          activityType: "label",
          activityName: "Welcome",
          resourceId: "label-Welcome-Welcome",
          url: "",
          hash: "",
          isAccessible: true,
        }],
      }],
    };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false });
    const downloads = plan.filter((a) => a.action === SyncAction.DOWNLOAD);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.resourceId).toBe("label-Welcome-Welcome");
  });
});

describe("STEP-017: --check-files flag", () => {
  it("returns DOWNLOAD for a file that exists in state but is missing on disk when checkFiles=true", () => {
    const stateFile = {
      courses: {
        "1": {
          name: "Macro",
          sections: {
            "s1": {
              files: {
                "r1": {
                  ...makeFile("r1", "aaa"),
                  // Use a path that definitely doesn't exist
                  localPath: "/tmp/definitely-does-not-exist-xyz-12345/file-r1.pdf",
                },
              },
            },
          },
        },
      },
    };
    const currentTree = {
      courseId: 1,
      sections: [{
        sectionId: "s1",
        sectionName: "Week 1",
        activities: [{
          activityType: "resource",
          resourceId: "r1",
          activityName: "file-r1.pdf",
          url: "https://moodle.example.com/r/r1",
          hash: "aaa",
          isAccessible: true,
        }],
      }],
    };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false, checkFiles: true });
    const downloads = plan.filter((a) => a.action === SyncAction.DOWNLOAD);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.resourceId).toBe("r1");
  });
});

describe("STEP-017: --dry-run flag", () => {
  // REQ-SYNC-009
  it("dry-run returns the same plan but marks all actions as dry-run", () => {
    const stateFile = { courses: { "1": { name: "Macro", sections: { "s1": { files: {} } } } } };
    const currentTree = { courseId: 1, sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [{ activityType: "resource", resourceId: "r1", name: "new.pdf", url: "https://moodle.example.com/r/r1", hash: "aaa", isAccessible: true }] }] };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false, dryRun: true });
    expect(plan.every((a) => a.dryRun === true)).toBe(true);
    expect(plan.some((a) => a.action === SyncAction.DOWNLOAD)).toBe(true);
  });
});

describe("STEP-017: hash system mismatch — SHA-256 vs Moodle data-hash (Pass 42 fix)", () => {
  // Root cause: fileState.hash stores SHA-256 (64 hex chars) for downloaded binary files,
  // but activity.hash is Moodle's opaque data-hash token (short string). Comparing them
  // directly always returns "not equal" → false DOWNLOAD every run.

  const sha256 = "a".repeat(64); // valid SHA-256: 64 lowercase hex chars

  it("returns SKIP when fileState.hash is SHA-256 and activity.hash is a Moodle token", () => {
    // This is the Dockerfile.base / sshd_config scenario: file was downloaded (SHA-256 stored),
    // but Moodle HTML has a data-hash token → previously always triggered re-download
    const stateFile = {
      courses: { "1": { name: "IT-Sec", sections: { "s1": { files: {
        "r1": { ...makeFile("r1", sha256), localPath: "/out/Dockerfile.base" },
      } } } } },
    };
    const currentTree = {
      courseId: 1,
      sections: [{ sectionId: "s1", sectionName: "Weitere Ressourcen", activities: [{
        activityType: "resource",
        resourceId: "r1",
        activityName: "Dockerfile.base",
        url: "https://moodle.example.com/r/r1",
        hash: "moodle-token-abc123",  // Moodle data-hash token, NOT a SHA-256
        isAccessible: true,
      }] }],
    };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false });
    const downloads = plan.filter((a) => a.action === SyncAction.DOWNLOAD);
    expect(downloads).toHaveLength(0); // must NOT re-download
  });

  it("returns SKIP when both hashes are Moodle tokens and they match", () => {
    // Acknowledged items (labels, info-md) store Moodle data-hash in state — comparison still works
    const stateFile = {
      courses: { "1": { name: "Course", sections: { "s1": { files: {
        "r1": { ...makeFile("r1", "moodle-token-xyz"), localPath: "/out/label.md" },
      } } } } },
    };
    const currentTree = {
      courseId: 1,
      sections: [{ sectionId: "s1", sectionName: "S1", activities: [{
        activityType: "label",
        resourceId: "r1",
        activityName: "label",
        url: "",
        hash: "moodle-token-xyz",
        isAccessible: true,
      }] }],
    };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false });
    const downloads = plan.filter((a) => a.action === SyncAction.DOWNLOAD);
    expect(downloads).toHaveLength(0);
  });

  it("returns DOWNLOAD when both hashes are Moodle tokens and they differ", () => {
    // Moodle changed the file — data-hash changed → must re-download
    const stateFile = {
      courses: { "1": { name: "Course", sections: { "s1": { files: {
        "r1": { ...makeFile("r1", "old-token"), localPath: "/out/label.md" },
      } } } } },
    };
    const currentTree = {
      courseId: 1,
      sections: [{ sectionId: "s1", sectionName: "S1", activities: [{
        activityType: "label",
        resourceId: "r1",
        activityName: "label",
        url: "",
        hash: "new-token",  // data-hash changed on Moodle
        isAccessible: true,
      }] }],
    };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false });
    const downloads = plan.filter((a) => a.action === SyncAction.DOWNLOAD);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.resourceId).toBe("r1");
  });
});

// ── T-27: orphanReason in sync plan ──────────────────────────────────────────

describe("T-27: orphanReason field in ORPHAN plan items", () => {
  const emptyTree = { courseId: 1, sections: [{ sectionId: "s1", sectionName: "S1", activities: [] }] };

  it("ORPHAN item gets orphanReason 'moodle-removed' when file had status 'ok'", () => {
    const state = {
      courses: {
        "1": { name: "Macro", sections: { "s1": { files: {
          "r1": { hash: "abc", url: "https://moodle.example.com/r/1", localPath: "/out/file.pdf", status: "ok" as const },
        } } } },
      },
    };
    const plan = computeSyncPlan({ state, currentTree: [emptyTree], force: false });
    const orphan = plan.find((a) => a.action === SyncAction.ORPHAN && a.resourceId === "r1");
    expect(orphan).toBeDefined();
    expect(orphan?.orphanReason).toBe("moodle-removed");
  });

  it("ORPHAN item gets orphanReason 'never-downloaded' when file had status 'error' and no downloadedAt", () => {
    const state = {
      courses: {
        "1": { name: "Macro", sections: { "s1": { files: {
          "r1": { hash: "", url: "https://moodle.example.com/r/1", localPath: "/out/file.pdf", status: "error" as const },
        } } } },
      },
    };
    const plan = computeSyncPlan({ state, currentTree: [emptyTree], force: false });
    const orphan = plan.find((a) => a.action === SyncAction.ORPHAN && a.resourceId === "r1");
    expect(orphan).toBeDefined();
    expect(orphan?.orphanReason).toBe("never-downloaded");
  });

  it("ORPHAN item gets orphanReason 'moodle-removed' when downloadedAt is set (even if status is error)", () => {
    const state = {
      courses: {
        "1": { name: "Macro", sections: { "s1": { files: {
          "r1": { hash: "", url: "https://moodle.example.com/r/1", localPath: "/out/file.pdf", status: "error" as const, downloadedAt: "2026-04-01T00:00:00.000Z" },
        } } } },
      },
    };
    const plan = computeSyncPlan({ state, currentTree: [emptyTree], force: false });
    const orphan = plan.find((a) => a.action === SyncAction.ORPHAN && a.resourceId === "r1");
    expect(orphan).toBeDefined();
    expect(orphan?.orphanReason).toBe("moodle-removed");
  });
});

// ── T-28: self-heal corrupted localPath="" state entries ─────────────────────

describe("T-28: self-heal corrupted state with localPath='' (Pass 44 noDescriptions bug)", () => {
  const makeTree = (url: string) => ({
    courseId: 1,
    sections: [{
      sectionId: "s0",
      sectionName: "Allgemeines",
      activities: [{
        activityName: "Lecture Slides",
        activityType: "resource",
        url,
        isAccessible: true,
        description: "Short desc",
      }],
    }],
  });

  it("re-downloads entry with localPath='' and no downloadedAt (corrupted state)", () => {
    const state = {
      courses: {
        "1": { name: "Course", sections: { "s0": { files: {
          "1-s0-Lecture Slides": {
            localPath: "",           // corrupted — file was never written to disk
            url: "https://moodle.example.com/mod/resource/view.php?id=42",
            hash: "",
            downloadedAt: undefined, // never saved
            status: "ok" as const,
          },
        } } } },
      },
    };
    const plan = computeSyncPlan({
      state,
      currentTree: [makeTree("https://moodle.example.com/mod/resource/view.php?id=42")],
      force: false,
    });
    const dl = plan.filter((p) => p.action === SyncAction.DOWNLOAD);
    expect(dl).toHaveLength(1);
    expect(dl[0]?.resourceId).toContain("Lecture Slides");
  });

  it("does NOT re-download entry with localPath='' when downloadedAt IS set (intentionally acknowledged)", () => {
    const state = {
      courses: {
        "1": { name: "Course", sections: { "s0": { files: {
          "1-s0-Lecture Slides": {
            localPath: "",
            url: "https://moodle.example.com/mod/resource/view.php?id=42",
            hash: "",
            downloadedAt: "2026-04-15T10:00:00.000Z", // was downloaded — empty localPath is intentional
            status: "ok" as const,
          },
        } } } },
      },
    };
    const plan = computeSyncPlan({
      state,
      currentTree: [makeTree("https://moodle.example.com/mod/resource/view.php?id=42")],
      force: false,
    });
    const dl = plan.filter((p) => p.action === SyncAction.DOWNLOAD);
    expect(dl).toHaveLength(0); // SKIP — already handled, no re-download needed
  });

  it("does NOT re-download entry with empty url (acknowledged label/assign with no real download)", () => {
    const makeTreeNoUrl = () => ({
      courseId: 1,
      sections: [{
        sectionId: "s0",
        sectionName: "Allgemeines",
        activities: [{
          activityName: "Lecture Slides",
          activityType: "label",
          url: "",
          isAccessible: true,
          description: "",
        }],
      }],
    });
    const state = {
      courses: {
        "1": { name: "Course", sections: { "s0": { files: {
          "1-s0-Lecture Slides": {
            localPath: "",
            url: "",
            hash: "",
            status: "ok" as const,
          },
        } } } },
      },
    };
    const plan = computeSyncPlan({
      state,
      currentTree: [makeTreeNoUrl()],
      force: false,
    });
    const dl = plan.filter((p) => p.action === SyncAction.DOWNLOAD);
    expect(dl).toHaveLength(0); // no URL → no re-download
  });
});
