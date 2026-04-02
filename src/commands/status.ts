// REQ-CLI-006, REQ-CLI-012, REQ-CLI-016
import { existsSync, statSync } from "node:fs";
import { relative } from "node:path";
import { StateManager } from "../sync/state.js";
import { collectFiles } from "../fs/collect.js";

export interface StatusOptions {
  outputDir: string;
  showIssues?: boolean;
}

/** Format bytes as human-readable size (MB or GB). */
function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** Format an ISO date string as "YYYY-MM-DD HH:MM". */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 16);
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

/** How long ago was a date? Returns e.g. "2 days ago", "just now". */
function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 2) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  } catch {
    return "";
  }
}

/** Build a simple tree view from a list of absolute paths relative to a base dir. */
function buildTreeLines(paths: string[], baseDir: string): string[] {
  // Group by directory
  const tree = new Map<string, string[]>();
  for (const p of paths) {
    const rel = relative(baseDir, p);
    const parts = rel.split("/");
    const dir = parts.slice(0, -1).join("/") || ".";
    const file = parts[parts.length - 1] ?? p;
    const list = tree.get(dir) ?? [];
    list.push(file);
    tree.set(dir, list);
  }
  const lines: string[] = [];
  for (const [dir, files] of tree) {
    if (dir !== ".") {
      // Indent each path component
      const parts = dir.split("/");
      for (let i = 0; i < parts.length; i++) {
        const indent = "  ".repeat(i + 1);
        if (i === parts.length - 1) {
          lines.push(`${indent}${parts[i]}/`);
        } else {
          // Only print parent dirs once — they appear when we process subdirs
        }
      }
    }
    const fileIndent = "  ".repeat(dir === "." ? 1 : dir.split("/").length + 1);
    for (const f of files) {
      lines.push(`${fileIndent}${f}`);
    }
  }
  return lines;
}

export async function runStatus(opts: StatusOptions): Promise<void> {
  const { outputDir, showIssues = false } = opts;
  const sm = new StateManager(outputDir);
  const state = await sm.load();

  if (!state) {
    process.stdout.write("No sync history. Run 'msc scrape' to start.\n");
    return;
  }

  const write = (s: string) => process.stdout.write(s + "\n");

  // Header
  write(`Output: ${outputDir}`);
  write(`Last sync: ${formatDate(state.lastSyncAt ?? "")}`);
  write("");

  // Collect stats
  let totalFiles = 0;
  let totalSize = 0;
  let orphanedFiles = 0;
  const orphans: Array<{ localPath: string; url: string }> = [];
  const missingFiles: Array<{ localPath: string; url: string }> = [];
  const knownPaths = new Set<string>();

  // Per-course stats: name → { files, size, lastModified }
  const courseStats = new Map<string, { label: string; files: number; size: number; lastModified: string }>();

  for (const [courseId, course] of Object.entries(state.courses)) {
    let courseFiles = 0;
    let courseSize = 0;
    let courseLastMod = "";

    for (const section of Object.values(course.sections ?? {})) {
      for (const file of Object.values(section.files ?? {})) {
        totalFiles++;
        courseFiles++;

        if (file.localPath) {
          knownPaths.add(file.localPath);
          if (file.sidecarPath) knownPaths.add(file.sidecarPath);
          if (file.status !== "orphan" && existsSync(file.localPath)) {
            try {
              const st = statSync(file.localPath);
              totalSize += st.size;
              courseSize += st.size;
            } catch { /* ignore */ }
          }
        }

        if (file.status === "orphan") {
          orphanedFiles++;
          orphans.push({ localPath: file.localPath, url: file.url });
        } else if (showIssues && file.localPath && !existsSync(file.localPath)) {
          missingFiles.push({ localPath: file.localPath, url: file.url });
        }

        if (file.lastModified && (!courseLastMod || file.lastModified > courseLastMod)) {
          courseLastMod = file.lastModified;
        }
      }
    }

    // Use course name; derive a display label from it
    const label = course.name ?? courseId;
    courseStats.set(courseId, { label, files: courseFiles, size: courseSize, lastModified: courseLastMod });
  }

  // Summary line
  const sizeStr = totalSize > 0 ? ` (${formatSize(totalSize)})` : "";
  write(`Courses: ${Object.keys(state.courses).length} | Files: ${totalFiles}${sizeStr} | Orphaned: ${orphanedFiles}`);
  write("");

  // Per-course table
  const maxLabel = Math.max(...[...courseStats.values()].map((s) => s.label.length), 0);
  for (const { label, files, size, lastModified } of courseStats.values()) {
    const labelPad = label.padEnd(maxLabel);
    const fileStr = `${files} file${files === 1 ? "" : "s"}`.padStart(9);
    const sizeCol = size > 0 ? `  (${formatSize(size)})`.padEnd(10) : "".padEnd(10);
    const timeCol = lastModified ? `  ${timeAgo(lastModified)}` : "";
    write(`  ${labelPad}  ${fileStr}${sizeCol}${timeCol}`);
  }

  // User-added files (files in outputDir not tracked by scraper)
  const allOnDisk = collectFiles(outputDir);
  const userFiles = allOnDisk.filter((p) => !knownPaths.has(p));

  write("");
  if (userFiles.length > 0) {
    write(`User-added files: ${userFiles.length}  (not managed by scraper — safe to keep)`);
  }

  if (!showIssues) {
    write("");
    write("Tip: Run `msc status --issues` to check for missing or orphaned files.");
    return;
  }

  // --issues: tree views
  if (orphans.length > 0) {
    write("");
    write(`Orphaned files (${orphans.length}):`);
    for (const line of buildTreeLines(orphans.map((o) => o.localPath), outputDir)) {
      write(line);
    }
  }

  if (missingFiles.length > 0) {
    write("");
    write(`Missing files (${missingFiles.length}) — in state but not on disk:`);
    for (const line of buildTreeLines(missingFiles.map((m) => m.localPath), outputDir)) {
      write(line);
    }
  }

  if (userFiles.length > 0) {
    write("");
    write(`User-added files (${userFiles.length}):`);
    for (const line of buildTreeLines(userFiles, outputDir)) {
      write(line);
    }
  }

  if (orphans.length === 0 && missingFiles.length === 0 && userFiles.length === 0) {
    write("No issues found.");
  }
}
