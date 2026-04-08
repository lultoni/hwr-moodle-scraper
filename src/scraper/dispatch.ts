// REQ-SCRAPE-005, REQ-SCRAPE-006, REQ-SCRAPE-007, REQ-SCRAPE-008
// Activity type dispatch: maps each modtype to a download strategy and destination path.
import { join } from "node:path";
import { sanitiseFilename } from "../fs/sanitise.js";
import { createTurndown } from "./turndown.js";
import type { Activity } from "./courses.js";

export type DownloadStrategy = "binary" | "url-txt" | "page-md" | "label-md" | "description-md" | "info-md";

export interface DownloadPlanItem {
  activity: Activity;
  /** URL to download. Undefined for label-md and description-md strategies (content comes from activity.description). */
  url: string;
  destPath: string;
  strategy: DownloadStrategy;
  courseName: string;
  sectionName: string;
}

/**
 * Activity types whose pages are worth fetching and converting to Markdown.
 * These serve HTML with readable content (discussion threads, quiz overviews, etc.).
 */
const PAGE_MD_TYPES = new Set([
  "forum",
  "quiz",
  "glossary",
  "book",
  "lesson",
  "wiki",
  "workshop",
]);

/**
 * Activity types that are interactive or embed external content — not fetchable as plain HTML.
 * These are saved as a structured info card (.md) containing the activity title, URL, and description.
 */
const INFO_MD_TYPES = new Set([
  "assign",
  "feedback",
  "choice",
  "vimp",        // Video player (HWR-specific)
  "hvp",         // H5P interactive content
  "h5pactivity", // H5P activity (Moodle 4.x native)
  "scorm",       // SCORM packages
  "flashcard",   // Flashcard module
  "survey",      // Survey module
  "chat",        // Chat module
  "lti",         // External Tool (LTI)
  "imscp",       // IMS Content Package
  "grouptool",
  "bigbluebuttonbn",
  "customcert",  // Course completion certificate (links to completion criteria, not downloadable)
  "etherpadlite", // Etherpad collaborative editor — not a downloadable file
]);

/**
 * Build a download plan for a list of activities in a single section.
 *
 * Strategy selection:
 *   - `binary`        — `resource` activities and expanded folder files; content downloaded as-is
 *   - `url-txt`       — `url` activities; target URL saved as a `.url.txt` text file
 *   - `page-md`       — `page`, `forum`, `quiz`, `glossary`, `book`, `lesson`, `wiki`, `workshop`;
 *                       HTML fetched and converted to Markdown
 *   - `label-md`      — `label` activities with a `description`; HTML description saved as `.md`
 *   - `description-md`— sidecar `.description.md` file generated for any non-label activity
 *                       that has a `description` field (activity details/metadata HTML)
 *   - `info-md`       — interactive/embed types (`assign`, `feedback`, `choice`, `vimp`, `hvp`, etc.);
 *                       a structured Markdown info card with title, Moodle URL, and description is saved
 *
 * Inaccessible activities are excluded.
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

    // Labels have no URL — only save if they have description content
    if (!activity.url && activity.activityType !== "label") continue;
    if (activity.activityType === "label" && !activity.description) continue;

    const safeName = sanitiseFilename(activity.activityName || "unnamed");
    const safeSection = sanitiseFilename(sectionName);
    const safeCourse = sanitiseFilename(courseName);
    const sectionDir = semesterDir
      ? join(outputDir, semesterDir, safeCourse, safeSection)
      : join(outputDir, safeCourse, safeSection);
    // Optional subfolder (e.g. when two folders contain same-named files)
    const fileDir = activity.subDir ? join(sectionDir, sanitiseFilename(activity.subDir)) : sectionDir;

    let destPath: string;
    let strategy: DownloadStrategy;

    switch (activity.activityType) {
      case "url":
        destPath = join(fileDir, `${safeName}.url.txt`);
        strategy = "url-txt";
        break;
      case "page":
        destPath = join(fileDir, `${safeName}.md`);
        strategy = "page-md";
        break;
      case "label":
        destPath = join(fileDir, `${safeName}.md`);
        strategy = "label-md";
        break;
      default:
        if (PAGE_MD_TYPES.has(activity.activityType)) {
          destPath = join(fileDir, `${safeName}.md`);
          strategy = "page-md";
        } else if (INFO_MD_TYPES.has(activity.activityType)) {
          destPath = join(fileDir, `${safeName}.md`);
          strategy = "info-md";
        } else {
          // resource, folder files (already expanded), and unknown types → binary
          destPath = join(fileDir, safeName);
          strategy = "binary";
        }
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

    // Sidecar: save description as .description.md alongside non-label, non-info-md items.
    // info-md items (assign, feedback, etc.) already embed the description in the main file
    // under "## Description", so a separate sidecar would be pure redundancy.
    // page-md items DO get a sidecar because their main file contains fetched page content
    // (not the description), so the description is genuinely separate metadata.
    if (activity.description && strategy !== "label-md" && strategy !== "info-md") {
      items.push({
        activity,
        url: activity.url,
        destPath: join(fileDir, `${safeName}.description.md`),
        strategy: "description-md",
        courseName,
        sectionName,
      });
    }
  }

  return items;
}

/**
 * Determine whether a label's HTML description represents a visual "divider"
 * — a short heading that Moodle instructors use to group activities visually.
 *
 * Divider labels are characterised by:
 *   - Very short text content (≤ 80 chars after stripping images and formatting)
 *   - At most 2 non-empty lines of text
 *   - No list items (ul/ol markers in the Markdown output)
 *   - No external links
 *
 * Content-rich labels (learning objectives, multi-paragraph descriptions) return false.
 */
export function isDividerLabel(descriptionHtml: string): boolean {
  if (!descriptionHtml || !descriptionHtml.trim()) return false;

  const td = createTurndown();
  const md = td.turndown(descriptionHtml);

  // Strip image markdown ![alt](url)
  const stripped = md.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

  // Strip heading markers and bold/italic
  const text = stripped
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*{1,3}/g, "")
    .replace(/_/g, " ")
    .trim();

  // Empty after stripping → not useful as divider
  if (!text) return false;

  // Must have at least 3 alphabetic characters to be a meaningful heading
  const alphaOnly = text.replace(/[^a-zA-ZäöüÄÖÜß]/g, "");
  if (alphaOnly.length < 3) return false;

  // Count non-empty lines
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length > 2) return false;

  // Total text length check
  const totalText = lines.join(" ").trim();
  if (totalText.length > 80) return false;

  // No list items
  if (/^[\s]*[-*+]\s/m.test(text)) return false;
  if (/^\s*\d+\.\s/m.test(text)) return false;

  // No external links [text](http...) — but exclude image links ![alt](http...)
  // Strip images first, then check for remaining links
  const mdWithoutImages = md.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(mdWithoutImages)) return false;

  return true;
}

/**
 * Walk a section's activities in order and assign `subDir` to activities
 * that follow divider labels, grouping them into subfolders.
 *
 * Safety: requires at least 2 divider labels in the section to activate.
 * A single divider could be a false positive; with ≥2 the instructor
 * clearly intends a visual structure.
 *
 * Does not mutate the input — returns a new array with cloned activities.
 * Activities that already have a `subDir` (from folder expansion) keep it.
 */
export function applyLabelSubfolders(activities: Activity[]): Activity[] {
  // First pass: identify divider labels and count them
  const dividerIndices: number[] = [];
  for (let i = 0; i < activities.length; i++) {
    const act = activities[i]!;
    if (act.activityType === "label" && act.description) {
      if (isDividerLabel(act.description)) dividerIndices.push(i);
    }
  }

  if (dividerIndices.length < 1) return activities;

  // Second pass: assign subDirs
  const result: Activity[] = [];
  let currentSubDir: string | undefined;

  for (let i = 0; i < activities.length; i++) {
    const act = activities[i]!;
    const clone = { ...act };

    if (dividerIndices.includes(i)) {
      // This is a divider label — use its name as the subfolder
      currentSubDir = act.activityName;
      clone.subDir = currentSubDir;
    } else if (currentSubDir) {
      // Activity after a divider — assign subDir unless it already has one
      if (!clone.subDir) {
        clone.subDir = currentSubDir;
      }
    }

    result.push(clone);
  }

  return result;
}
