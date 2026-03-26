// REQ-SCRAPE-005, REQ-SCRAPE-006, REQ-SCRAPE-007, REQ-SCRAPE-008
import { writeFileSync, appendFileSync } from "node:fs";
import TurndownService from "turndown";

const td = new TurndownService();

export async function writeUrlFile(destPath: string, url: string): Promise<void> {
  writeFileSync(destPath, url + "\n", { mode: 0o600 });
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
