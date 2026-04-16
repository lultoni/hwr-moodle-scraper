// REQ-SCRAPE-005, REQ-SCRAPE-006, REQ-SCRAPE-007, REQ-SCRAPE-008
import { writeFileSync, appendFileSync } from "node:fs";
import { createTurndown } from "./turndown.js";

const td = createTurndown();

/** Write a macOS .webloc file (XML plist) that opens a URL in the default browser. */
export function writeWeblocFile(destPath: string, url: string): void {
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `\t<key>URL</key>`,
    `\t<string>${url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</string>`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
  writeFileSync(destPath, xml, { mode: 0o600 });
}

/** Write a Windows .url shortcut file (INI format). */
export function writeWindowsUrlFile(destPath: string, url: string): void {
  const content = `[InternetShortcut]\r\nURL=${url}\r\n`;
  writeFileSync(destPath, content, { mode: 0o600 });
}

export async function writeUrlFile(
  destPath: string,
  url: string,
  opts?: { name?: string; description?: string },
): Promise<void> {
  const lines: string[] = [];
  if (opts?.name) lines.push(`# ${opts.name}`, "");
  lines.push(url);
  if (opts?.description) {
    lines.push("", "## Beschreibung", "", td.turndown(opts.description).trim());
  }
  lines.push("");
  writeFileSync(destPath, lines.join("\n"), { mode: 0o600 });
}

export interface AssignmentMeta {
  title: string;
  dueDate: string | null;
  description: string;
  submissionType: string;
}

export async function writeAssignmentDescription(
  destPath: string,
  meta: AssignmentMeta
): Promise<void> {
  const dueDateStr = meta.dueDate
    ? new Date(meta.dueDate).toISOString().split("T")[0]
    : "No due date";
  const descMd = td.turndown(meta.description);
  const content = [
    `# ${meta.title}`,
    ``,
    `**Due date:** ${dueDateStr}`,
    `**Submission type:** ${meta.submissionType}`,
    ``,
    `## Description`,
    ``,
    descMd,
    ``,
  ].join("\n");
  writeFileSync(destPath, content, { mode: 0o600 });
}

export interface ForumPostMeta {
  title: string;
  author: string;
  timestamp: string;
  body: string;
}

export async function writeForumPost(destPath: string, meta: ForumPostMeta): Promise<void> {
  const bodyMd = td.turndown(meta.body);
  const content = [
    `---`,
    `author: ${meta.author}`,
    `timestamp: ${meta.timestamp}`,
    `subject: ${meta.title}`,
    `---`,
    ``,
    bodyMd,
    ``,
  ].join("\n");
  writeFileSync(destPath, content, { mode: 0o600 });
}

export async function appendLabelContent(labelsFilePath: string, html: string): Promise<void> {
  const md = td.turndown(html);
  appendFileSync(labelsFilePath, md + "\n\n", { mode: 0o600 });
}

/**
 * Extract the real external URL from a Moodle URL activity page.
 *
 * Moodle wraps external links in a `<div class="urlworkaround">` containing
 * an `<a href="REAL_URL">` tag. This function locates that div and extracts
 * the href, decoding any HTML entities (e.g. `&amp;` → `&`).
 *
 * Returns null if no urlworkaround div or anchor is found.
 */
export function extractExternalUrl(html: string): string | null {
  // Find the urlworkaround div (any position in class attribute)
  const divRe = /<div[^>]+class="[^"]*\burlworkaround\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
  const divM = divRe.exec(html);
  if (!divM?.[1]) return null;
  // Extract the first href from inside the div
  const aRe = /<a[^>]+href="([^"]+)"[^>]*>/i;
  const aM = aRe.exec(divM[1]);
  if (!aM?.[1]) return null;
  // Decode HTML entities in the URL
  return aM[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
