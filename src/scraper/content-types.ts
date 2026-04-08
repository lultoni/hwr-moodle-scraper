// REQ-SCRAPE-005, REQ-SCRAPE-006, REQ-SCRAPE-007, REQ-SCRAPE-008
import { writeFileSync, appendFileSync } from "node:fs";
import { createTurndown } from "./turndown.js";

const td = createTurndown();

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
