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

describe("STEP-017: --dry-run mode", () => {
  // REQ-SYNC-009
  it("dry-run returns the same plan but marks all actions as dry-run", () => {
    const stateFile = { courses: { "1": { name: "Macro", sections: { "s1": { files: {} } } } } };
    const currentTree = { courseId: 1, sections: [{ sectionId: "s1", sectionName: "Week 1", activities: [{ activityType: "resource", resourceId: "r1", name: "new.pdf", url: "https://moodle.example.com/r/r1", hash: "aaa", isAccessible: true }] }] };

    const plan = computeSyncPlan({ state: stateFile, currentTree: [currentTree], force: false, dryRun: true });
    expect(plan.every((a) => a.dryRun === true)).toBe(true);
    expect(plan.some((a) => a.action === SyncAction.DOWNLOAD)).toBe(true);
  });
});
