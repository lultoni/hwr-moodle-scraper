// REQ-CLI-006, REQ-CLI-012, REQ-CLI-016
import { existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { StateManager } from "../sync/state.js";
import { collectFiles } from "../fs/collect.js";

export interface StatusOptions {
  outputDir: string;
  showIssues?: boolean;
  showChanged?: boolean;
  dismissOrphans?: boolean;
  dryRun?: boolean;
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

/** Build a tree view from a list of absolute paths relative to a base dir, with box-drawing chars. */
function buildTreeLines(paths: string[], baseDir: string): string[] {
  // Build a nested map: dir-path-parts → leaf file names
  type TreeNode = { children: Map<string, TreeNode>; files: string[] };
  const root: TreeNode = { children: new Map(), files: [] };

  for (const p of paths) {
    const rel = relative(baseDir, p);
    const parts = rel.split("/");
    const fileName = parts.pop()!;
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, { children: new Map(), files: [] });
      }
      node = node.children.get(part)!;
    }
    node.files.push(fileName);
  }

  const lines: string[] = [];

  function renderNode(node: TreeNode, prefix: string): void {
    const allEntries: Array<{ name: string; isDir: boolean; node?: TreeNode }> = [
      ...Array.from(node.children.entries()).map(([name, child]) => ({ name, isDir: true, node: child })),
      ...node.files.map((f) => ({ name: f, isDir: false })),
    ];
    for (let i = 0; i < allEntries.length; i++) {
      const entry = allEntries[i]!;
      const isLast = i === allEntries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";
      if (entry.isDir) {
        lines.push(`${prefix}${connector}${entry.name}/`);
        renderNode(entry.node!, prefix + childPrefix);
      } else {
        lines.push(`${prefix}${connector}${entry.name}`);
      }
    }
  }

  renderNode(root, "");
  return lines;
}

export async function runStatus(opts: StatusOptions): Promise<void> {
  const { outputDir, showIssues = false, showChanged = false, dismissOrphans = false, dryRun = false } = opts;
  const sm = new StateManager(outputDir);
  const state = await sm.load();

  if (!state) {
    process.stdout.write("No sync history. Run 'msc scrape' to start.\n");
    return;
  }

  const write = (s: string) => process.stdout.write(s + "\n");

  // ── --dismiss-orphans: remove orphan state entries ─────────────────────────
  if (dismissOrphans) {
    let count = 0;
    for (const course of Object.values(state.courses)) {
      for (const section of Object.values(course.sections ?? {})) {
        const toDelete: string[] = [];
        for (const [fileId, file] of Object.entries(section.files ?? {})) {
          if (file.status === "orphan") toDelete.push(fileId);
        }
        for (const fileId of toDelete) {
          delete (section.files as Record<string, unknown>)[fileId];
          count++;
        }
      }
    }
    if (dryRun) {
      write(`[dry-run] Would remove ${count} old state entr${count === 1 ? "y" : "ies"}. Files on disk would be unchanged.`);
    } else {
      const saveData: Parameters<typeof sm.save>[0] = { courses: state.courses, generatedFiles: state.generatedFiles ?? [] };
      if (state.lastSync) saveData.lastSync = state.lastSync;
      await sm.save(saveData);
      write(`Removed ${count} old state entr${count === 1 ? "y" : "ies"}. Files on disk are unchanged.`);
    }
    return;
  }

  // ── --changed: replay last-scrape change report from state ────────────────
  if (showChanged) {
    const ls = state.lastSync;
    if (!ls) {
      write("No sync history available. Run `msc scrape` first.");
      return;
    }
    write(`Last sync: ${ls.timestamp}`);
    write(`Legend: + new  ~ updated`);
    if (ls.newFiles.length === 0 && ls.updatedFiles.length === 0) {
      write("No changes in last run.");
    } else {
      if (ls.newFiles.length > 0) {
        write("");
        write(`New files (${ls.newFiles.length}):`);
        for (const f of ls.newFiles) write(`  + ${f}`);
      }
      if (ls.updatedFiles.length > 0) {
        write("");
        write(`Updated files (${ls.updatedFiles.length}):`);
        for (const f of ls.updatedFiles) write(`  ~ ${f}`);
      }
    }
    return;
  }

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

  // Include generated files (README.md, _Abschnittsbeschreibung.md) written outside FileState
  for (const p of state.generatedFiles ?? []) knownPaths.add(p.normalize("NFC"));

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
          // Normalise to NFC — state paths may be NFD (from macOS rename) or NFC (from HTML).
          // collectFiles() also returns NFC, so both sides must match.
          knownPaths.add(file.localPath.normalize("NFC"));
          if (file.sidecarPath) knownPaths.add(file.sidecarPath.normalize("NFC"));
          for (const sp of file.submissionPaths ?? []) knownPaths.add(sp.normalize("NFC"));
          for (const ip of file.imagePaths ?? []) knownPaths.add(ip.normalize("NFC"));
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
  write(`Courses: ${Object.keys(state.courses).length} | Files: ${totalFiles}${sizeStr} | Old entries: ${orphanedFiles}`);
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
  const allUserFiles = allOnDisk.filter((p) => !knownPaths.has(p));

  // Files already relocated by `msc clean --move` live in "User Files/" — not an issue.
  const userFilesDir = join(outputDir, "User Files");
  const managedUserFiles = allUserFiles.filter((p) => p.startsWith(userFilesDir + sep));
  const userFiles = allUserFiles.filter((p) => !p.startsWith(userFilesDir + sep));

  write("");
  if (userFiles.length > 0) {
    write(`User-added files: ${userFiles.length}  (not managed by scraper — safe to keep)`);
    write(`  Tip: Run \`msc clean\` to remove them, or \`msc clean --move\` to relocate to "User Files/".`);
  }
  if (managedUserFiles.length > 0) {
    write(`User Files/: ${managedUserFiles.length} file${managedUserFiles.length === 1 ? "" : "s"} (relocated by \`msc clean --move\`)`);
  }

  if (!showIssues) {
    write("");
    write("Tip: Run `msc status --issues` to check for missing files or old entries.");
    return;
  }

  // --issues: tree views
  if (orphans.length > 0) {
    write("");
    write(`Old entries — from ended courses (${orphans.length}):`);
    for (const line of buildTreeLines(orphans.map((o) => o.localPath), outputDir)) {
      write(line);
    }
    write("  (Files on disk are untouched. To clean up, run `msc status --dismiss-orphans`.)");
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

  if (managedUserFiles.length > 0) {
    write("");
    write(`User Files/ (relocated by \`msc clean --move\`, ${managedUserFiles.length} file${managedUserFiles.length === 1 ? "" : "s"} — not shown)`);
  }

  if (orphans.length === 0 && missingFiles.length === 0 && userFiles.length === 0) {
    write("No issues found.");
  } else {
    // Contextual tips based on what was found
    write("");
    if (userFiles.length > 0) {
      write("Tip: Run `msc clean` to remove personal files, or `msc clean --move` to relocate them.");
    }
    if (orphans.length > 0 && userFiles.length === 0) {
      write("Tip: Run `msc status --dismiss-orphans` to clean up old state entries.");
    } else if (orphans.length > 0) {
      write("Tip: Run `msc status --dismiss-orphans` to clean up old state entries.");
    }
  }
}
