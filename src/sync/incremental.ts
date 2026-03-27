// REQ-SYNC-003 through REQ-SYNC-009
import { existsSync } from "node:fs";
import type { State } from "./state.js";
import type { ContentTree } from "../scraper/courses.js";
import { getResourceId } from "../scraper/resource-id.js";

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
      files?: Record<string, { hash?: string; url?: string; localPath?: string }>;
    }>;
  }>;
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
          || (activity.hash && fileState.hash !== activity.hash)
          || (checkFiles && fileState.localPath && !existsSync(fileState.localPath));

        if (needsDownload) {
          plan.push({
            action: SyncAction.DOWNLOAD,
            resourceId,
            courseId: tree.courseId,
            url: activity.url,
            dryRun,
          });
        } else {
          plan.push({ action: SyncAction.SKIP, resourceId, dryRun });
        }
      }

      // Detect orphaned files in this section
      if (sectionState?.files) {
        const currentResourceIds = new Set(
          section.activities.map((a) => getResourceId(a, tree.courseId, section.sectionId))
        );
        for (const resourceId of Object.keys(sectionState.files)) {
          if (!currentResourceIds.has(resourceId)) {
            plan.push({ action: SyncAction.ORPHAN, resourceId, dryRun });
          }
        }
      }
    }
  }

  return plan;
}
