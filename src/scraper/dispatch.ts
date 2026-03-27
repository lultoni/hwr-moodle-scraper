// REQ-SCRAPE-005, REQ-SCRAPE-006, REQ-SCRAPE-007, REQ-SCRAPE-008
// Activity type dispatch: maps each modtype to a download strategy and destination path.
import { join } from "node:path";
import { sanitiseFilename } from "../fs/sanitise.js";
import type { Activity } from "./courses.js";

export type DownloadStrategy = "binary" | "url-txt" | "page-md" | "label-md" | "description-md";

export interface DownloadPlanItem {
  activity: Activity;
  /** URL to download. Undefined for label-md and description-md strategies (content comes from activity.description). */
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
]);

/**
 * Build a download plan for a list of activities in a single section.
 *
 * Strategy selection:
 *   - `binary`        — `resource` activities and expanded folder files; content downloaded as-is
 *   - `url-txt`       — `url` activities; target URL saved as a `.url.txt` text file
 *   - `page-md`       — `page` activities; HTML fetched and converted to Markdown
 *   - `label-md`      — `label` activities with a `description`; HTML description saved as `.md`
 *   - `description-md`— sidecar `.description.md` file generated for any non-label activity
 *                       that has a `description` field (activity details/metadata HTML)
 *
 * Inaccessible activities and non-downloadable types (assign, forum, quiz, etc.) are excluded.
 * Labels without description content are also excluded (nothing to save).
 */
export function buildDownloadPlan(
  activities: Activity[],
  courseName: string,
  sectionName: string,
  outputDir: string,
  semesterDir?: string,
): DownloadPlanItem[] {
  const items: DownloadPlanItem[] = [];

  for (const activity of activities) {
    if (!activity.isAccessible) continue;
    if (SKIP_TYPES.has(activity.activityType)) continue;

    // Labels have no URL — only save if they have description content
    if (!activity.url && activity.activityType !== "label") continue;
    if (activity.activityType === "label" && !activity.description) continue;

    const safeName = sanitiseFilename(activity.activityName || "unnamed");
    const safeSection = sanitiseFilename(sectionName);
    const safeCourse = sanitiseFilename(courseName);
    const sectionDir = semesterDir
      ? join(outputDir, semesterDir, safeCourse, safeSection)
      : join(outputDir, safeCourse, safeSection);

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
      case "label":
        destPath = join(sectionDir, `${safeName}.md`);
        strategy = "label-md";
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

    // Sidecar: save description as .description.md alongside binary/url/page items
    if (activity.description && strategy !== "label-md") {
      items.push({
        activity,
        url: activity.url,
        destPath: join(sectionDir, `${safeName}.description.md`),
        strategy: "description-md",
        courseName,
        sectionName,
      });
    }
  }

  return items;
}
