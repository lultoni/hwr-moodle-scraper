// REQ-SCRAPE-005, REQ-SCRAPE-006, REQ-SCRAPE-007, REQ-SCRAPE-008
// Activity type dispatch: maps each modtype to a download strategy and destination path.
import { join } from "node:path";
import { sanitiseFilename } from "../fs/sanitise.js";
import type { Activity } from "./courses.js";

export type DownloadStrategy = "binary" | "url-txt" | "page-md";

export interface DownloadPlanItem {
  activity: Activity;
  url: string;
  destPath: string;
  strategy: DownloadStrategy;
  courseName: string;
  sectionName: string;
}

/** Activity types that are not directly downloadable. */
const SKIP_TYPES = new Set([
  "assign",
  "forum",
  "quiz",
  "glossary",
  "grouptool",
  "bigbluebuttonbn",
  "label",
]);

/**
 * Build a download plan for a list of activities in a single section.
 * Inaccessible activities and non-downloadable types are excluded.
 */
export function buildDownloadPlan(
  activities: Activity[],
  courseName: string,
  sectionName: string,
  outputDir: string,
): DownloadPlanItem[] {
  const items: DownloadPlanItem[] = [];

  for (const activity of activities) {
    if (!activity.isAccessible) continue;
    if (!activity.url) continue;
    if (SKIP_TYPES.has(activity.activityType)) continue;

    const safeName = sanitiseFilename(activity.activityName || "unnamed");
    const safeSection = sanitiseFilename(sectionName);
    const safeCourse = sanitiseFilename(courseName);
    const sectionDir = join(outputDir, safeCourse, safeSection);

    let destPath: string;
    let strategy: DownloadStrategy;

    switch (activity.activityType) {
      case "url":
        destPath = join(sectionDir, `${safeName}.url.txt`);
        strategy = "url-txt";
        break;
      case "page":
        destPath = join(sectionDir, `${safeName}.md`);
        strategy = "page-md";
        break;
      default:
        // resource, folder files (already expanded), and unknown types → binary
        destPath = join(sectionDir, safeName);
        strategy = "binary";
        break;
    }

    items.push({
      activity,
      url: activity.url,
      destPath,
      strategy,
      courseName,
      sectionName,
    });
  }

  return items;
}
