// REQ-SYNC-003 through REQ-SYNC-009
import { existsSync } from "node:fs";
import type { State } from "./state.js";
import type { ContentTree } from "../scraper/courses.js";
import { getResourceId } from "../scraper/resource-id.js";
import { computeFileHash } from "../fs/output.js";

export enum SyncAction {
  DOWNLOAD = "DOWNLOAD",
  SKIP = "SKIP",
  ORPHAN = "ORPHAN",
  ORPHAN_COURSE = "ORPHAN_COURSE",
}

export interface SyncPlanItem {
  action: SyncAction;
  resourceId?: string;
  courseId?: number;
  url?: string;
  localPath?: string;
  dryRun?: boolean;
  /** Why this entry became an orphan. Populated for ORPHAN actions only. */
  orphanReason?: "moodle-removed" | "never-downloaded";
}

export interface ComputeSyncPlanOptions {
  state: PartialStateInput;
  currentTree: ContentTree[];
  force: boolean;
  checkFiles?: boolean;
  dryRun?: boolean;
}

interface PartialStateInput {
  courses: Record<string, {
    name?: string;
    sections?: Record<string, {
      files?: Record<string, { hash?: string; url?: string; localPath?: string; status?: string; downloadedAt?: string }>;
    }>;
  }>;
}

/**
 * Returns true if the hash string is a SHA-256 hex digest (64 lowercase hex chars).
 * Used to distinguish SHA-256 digests (computed from local file content) from
 * Moodle's opaque data-hash tokens (short strings used as change markers).
 * These two systems must not be compared directly.
 */
function isSha256(h: string): boolean {
  return /^[0-9a-f]{64}$/.test(h);
}

export function computeSyncPlan(opts: ComputeSyncPlanOptions): SyncPlanItem[] {
  const { state, currentTree, force, checkFiles = false, dryRun = false } = opts;
  const plan: SyncPlanItem[] = [];

  const currentCourseIds = new Set(currentTree.map((c) => String(c.courseId)));

  // Detect orphaned courses (in state but not in current tree)
  for (const courseId of Object.keys(state.courses)) {
    if (!currentCourseIds.has(courseId)) {
      plan.push({ action: SyncAction.ORPHAN_COURSE, courseId: Number(courseId), dryRun });
    }
  }

  // Process each current course
  for (const tree of currentTree) {
    const courseIdStr = String(tree.courseId);
    const courseState = state.courses[courseIdStr];

    for (const section of tree.sections) {
      const sectionState = courseState?.sections?.[section.sectionId];

      for (const activity of section.activities) {
        if (!activity.isAccessible) continue;
        const resourceId = getResourceId(activity, tree.courseId, section.sectionId);
        const fileState = sectionState?.files?.[resourceId];

        const needsDownload = force
          || !fileState
          // Moodle data-hash comparison: only valid when fileState.hash is also a Moodle token
          // (not a SHA-256). SHA-256 and Moodle tokens are different systems — comparing them
          // directly always returns "not equal" and triggers false re-downloads every run.
          || (activity.hash && !isSha256(fileState.hash ?? "") && fileState.hash !== activity.hash)
          || (checkFiles && fileState.localPath && !existsSync(fileState.localPath))
          || (checkFiles && fileState.localPath && fileState.hash
              && existsSync(fileState.localPath)
              && computeFileHash(fileState.localPath) !== fileState.hash);

        if (needsDownload) {
          plan.push({
            action: SyncAction.DOWNLOAD,
            resourceId,
            courseId: tree.courseId,
            url: activity.url,
            dryRun,
          });
        } else {
          plan.push({ action: SyncAction.SKIP, resourceId, courseId: tree.courseId, url: activity.url, dryRun });
        }
      }

      // Detect orphaned files in this section
      if (sectionState?.files) {
        const currentResourceIds = new Set(
          section.activities.map((a) => getResourceId(a, tree.courseId, section.sectionId))
        );
        for (const [resourceId, fileState] of Object.entries(sectionState.files)) {
          if (!currentResourceIds.has(resourceId)) {
            const wasEverDownloaded = fileState.status === "ok" || Boolean(fileState.downloadedAt);
            const orphanReason = wasEverDownloaded ? "moodle-removed" : "never-downloaded";
            plan.push({ action: SyncAction.ORPHAN, resourceId, dryRun, orphanReason });
          }
        }
      }
    }
  }

  return plan;
}
