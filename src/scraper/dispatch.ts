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
export interface DownloadPlanResult {
  items: DownloadPlanItem[];
  /** Activity types that were not in PAGE_MD_TYPES or INFO_MD_TYPES — treated as binary. */
  unknownTypes: Map<string, string[]>;
}

export function buildDownloadPlan(
  activities: Activity[],
  courseName: string,
  sectionName: string,
  outputDir: string,
  semesterDir?: string,
): DownloadPlanResult {
  const items: DownloadPlanItem[] = [];
  /** modtype → list of activity names with that type */
  const unknownTypes = new Map<string, string[]>();

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

    // Skip separator-only labels (just <hr>, "* * *", nbsp, etc.)
    if (activity.activityType === "label" && activity.description && isEmptyLabel(activity.description)) continue;

    // Optional subfolder (e.g. when two folders contain same-named files)
    // Compound subDir (e.g. "Materialien/Foliensammlung") is split into segments
    const fileDir = activity.subDir
      ? join(sectionDir, ...activity.subDir.split(/[\\/]/).map(sanitiseFilename))
      : sectionDir;

    // Divider labels that are heading-only (e.g. "Textmaterialien") are visual
    // section headings — skip them. But content-rich dividers (e.g. "Lernziele"
    // with learning objectives) should be written as _SubfolderName.md inside
    // their subfolder, similar to _FolderDescription.md for folders.
    if (activity.isDivider) {
      if (!activity.description || !isDividerContentRich(activity.description)) continue;
      // Content-rich divider → write as _SubfolderName.md
      const subDirName = activity.subDir?.split(/[\\/]/).pop() || sanitiseFilename(activity.activityName || "unnamed");
      const richDestPath = join(fileDir, `_${sanitiseFilename(subDirName)}.md`);
      items.push({
        activity,
        url: activity.url,
        destPath: richDestPath,
        strategy: "label-md",
        courseName,
        sectionName,
      });
      continue;
    }

    let destPath: string;
    let strategy: DownloadStrategy;

    switch (activity.activityType) {
      case "url":
        // URL activities are placed in a _Links/ subfolder to avoid cluttering the section dir
        // with .url.txt + .webloc pairs for every link. The subfolder sorts before alphabetic
        // folders (leading underscore) and signals "secondary/reference content".
        destPath = join(fileDir, "_Links", `${safeName}.url.txt`);
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
          // Track truly unknown types (not resource/folder which are expected binary)
          if (activity.activityType !== "resource" && activity.activityType !== "folder") {
            const list = unknownTypes.get(activity.activityType) ?? [];
            list.push(activity.activityName);
            unknownTypes.set(activity.activityType, list);
          }
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
    // url-txt sidecars live in the same _Links/ folder as the .url.txt file.
    if (activity.description && strategy !== "label-md" && strategy !== "info-md") {
      const sidecarDir = strategy === "url-txt" ? join(fileDir, "_Links") : fileDir;
      items.push({
        activity,
        url: activity.url,
        destPath: join(sidecarDir, `${safeName}.description.md`),
        strategy: "description-md",
        courseName,
        sectionName,
      });
    }
  }

  return { items, unknownTypes };
}

/**
 * Extract the heading text from an "icon-heading" label pattern.
 *
 * WissArb-style labels use `<img>` + `<h3>`/`<h4>`/`<h5>` to create visual
 * section dividers. The `data-activityname` attribute is often polluted with
 * icon attribution text (e.g. "Material\nIcons erstellt von Eucalyp..."),
 * but the heading element contains the clean name.
 *
 * Detects two sub-patterns:
 *   1. `<img>` anywhere before a heading (`<h3>`, `<h4>`, `<h5>`)
 *   2. `<img>` inside a heading tag
 *
 * Returns the cleaned heading text, or `null` if the pattern is not found.
 */
export function extractIconHeadingText(html: string): string | null {
  if (!html) return null;
  // Input length guard — prevents polynomial backtracking on pathological input
  if (html.length > 10_000) return null;

  // Must contain an <img> tag
  if (!/<img\s/i.test(html)) return null;

  // Pattern A (two-pass): <img> inside a heading tag — extract text after the img
  // First pass: find heading tags; second pass: check for <img> inside
  const headingRe = /<h([3-5])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(html)) !== null) {
    const innerHtml = hm[2]!;
    if (/<img\s/i.test(innerHtml)) {
      // Extract text after the <img> tag
      const afterImg = innerHtml.replace(/^[\s\S]*?<img\s[^>]*>/, "");
      const raw = afterImg
        .replace(/<[^>]+>/g, "")  // strip remaining HTML tags
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (raw.length >= 2) return raw;
    }
  }

  // Pattern B: <img> in a preceding element, then a heading follows
  // e.g. <div><img src="..."></div>\n<h3><span>Lernziele</span></h3>
  const afterImg = /<img\s[^>]*>[\s\S]*?<h([3-5])[^>]*>([\s\S]*?)<\/h\1>/i.exec(html);
  if (afterImg) {
    const raw = afterImg[2]!
      .replace(/<[^>]+>/g, "")  // strip HTML tags (e.g. <span>)
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (raw.length >= 2) return raw;
  }

  return null;
}

/**
 * Determine whether a label's HTML description represents a visual "divider"
 * — a short heading that Moodle instructors use to group activities visually.
 *
 * Two detection paths:
 *
 * 1. **Icon-heading pattern** (WissArb): `<img>` + `<h3>`/`<h4>`/`<h5>`.
 *    These are always dividers regardless of subsequent content (attribution
 *    links, learning objectives, etc.).
 *
 * 2. **Text heuristic** (VdZ, FRbüro): short text (≤80 chars, ≤2 lines),
 *    no list items, no external links, ≥3 alpha chars.
 *
 * Content-rich labels without the icon-heading pattern return false.
 */
export function isDividerLabel(descriptionHtml: string): boolean {
  if (!descriptionHtml || !descriptionHtml.trim()) return false;

  // Check for icon-heading pattern: a small decorative image (<= 100px)
  // followed by or inside a heading tag (h3/h4/h5). This is a common Moodle
  // pattern where instructors create visual section breaks with an icon + heading.
  // When detected with a small icon, it's always a divider regardless of
  // body text that may follow (e.g. learning objectives under the heading).
  const headingText = extractIconHeadingText(descriptionHtml);
  if (headingText !== null && hasSmallIcon(descriptionHtml)) return true;

  const td = createTurndown();
  let md: string;
  try {
    md = td.turndown(descriptionHtml);
  } catch {
    return false; // malformed HTML causes Turndown crash — treat as non-divider
  }
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
 * Check if the HTML contains a small decorative icon image (width or height ≤ 100px).
 * Small icons are typically used as visual decorations in section-divider labels,
 * not as content images.
 */
function hasSmallIcon(html: string): boolean {
  // Match <img> tags and check for width/height attributes
  const imgRegex = /<img\s[^>]*>/gi;
  let m;
  while ((m = imgRegex.exec(html)) !== null) {
    const tag = m[0];
    const widthMatch = /\bwidth=["']?(\d+)["']?/i.exec(tag);
    const heightMatch = /\bheight=["']?(\d+)["']?/i.exec(tag);
    if (widthMatch && Number(widthMatch[1]) <= 100) return true;
    if (heightMatch && Number(heightMatch[1]) <= 100) return true;
  }
  return false;
}

/**
 * Strip trailing "(Kopie)" patterns from a label name.
 * Moodle's internal `data-activityname` often contains "(Kopie)" from instructor
 * copy-paste operations, even though the rendered HTML shows clean names.
 */
function stripKopie(name: string): string {
  return name.replace(/\s*\(Kopie\)/gi, "").trim();
}

/**
 * Returns true if a label's HTML description is effectively empty —
 * just separators (`<hr>`, `* * *`), `&nbsp;`, or whitespace.
 * These should not produce `.md` files.
 */
export function isEmptyLabel(descriptionHtml: string): boolean {
  const td = createTurndown();
  let md: string;
  try {
    md = td.turndown(descriptionHtml);
  } catch {
    return false; // malformed HTML — assume non-empty rather than silently dropping content
  }

  // Strip image markdown, horizontal rules, whitespace, and non-alpha chars
  const stripped = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  // Check if fewer than 3 alphabetic characters remain
  const alpha = stripped.replace(/[^a-zA-ZäöüÄÖÜß]/g, "");
  return alpha.length < 3;
}

/**
 * Checks whether a divider label's HTML contains substantial content
 * beyond the heading, icon, and attribution text.
 *
 * Strips: the heading element (h3/h4/h5), <img> tags, and "Icons erstellt von"
 * credit paragraphs. If meaningful content (lists, paragraphs with ≥10 alpha chars)
 * remains, the divider is content-rich and should be written as a file.
 */
export function isDividerContentRich(descriptionHtml: string): boolean {
  if (!descriptionHtml) return false;

  let html = descriptionHtml;

  // Strip heading tags (h3/h4/h5) and their contents
  html = html.replace(/<h[3-5][^>]*>[\s\S]*?<\/h[3-5]>/gi, "");

  // Strip all <img> tags
  html = html.replace(/<img\s[^>]*>/gi, "");

  // Strip "Icons erstellt von" credit paragraphs (font-size: 9px or matching text)
  html = html.replace(/<p[^>]*>[\s\S]*?Icons\s+erstellt\s+von[\s\S]*?<\/p>/gi, "");

  // Now convert remaining HTML to text to check for content
  const td = createTurndown();
  let md: string;
  try {
    md = td.turndown(html);
  } catch {
    return false; // malformed HTML — treat as heading-only (no content file written)
  }

  // Strip image markdown, links markdown syntax, whitespace
  const stripped = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Check if meaningful alpha content remains (≥10 chars indicates real content)
  const alpha = stripped.replace(/[^a-zA-ZäöüÄÖÜß]/g, "");
  return alpha.length >= 10;
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
    if (act.activityType === "label" && act.description && !act.subDir) {
      if (isDividerLabel(act.description)) dividerIndices.push(i);
    }
  }

  if (dividerIndices.length < 2) return activities;

  // Second pass: assign subDirs
  const result: Activity[] = [];
  let currentSubDir: string | undefined;

  for (let i = 0; i < activities.length; i++) {
    const act = activities[i]!;
    const clone = { ...act };

    if (dividerIndices.includes(i)) {
      // This is a divider label — use its name as the subfolder
      // Prefer heading text extracted from icon-heading HTML (clean, no attribution noise)
      const headingText = act.description ? extractIconHeadingText(act.description) : null;
      currentSubDir = stripKopie(headingText || act.activityName);
      clone.subDir = currentSubDir;
      clone.isDivider = true;
    } else if (currentSubDir) {
      // Activity after a divider — nest under divider subfolder
      if (clone.subDir) {
        // Already has subDir (e.g. from folder expansion) → compound path
        clone.subDir = currentSubDir + "/" + clone.subDir;
      } else {
        clone.subDir = currentSubDir;
      }
    }

    result.push(clone);
  }

  return result;
}
