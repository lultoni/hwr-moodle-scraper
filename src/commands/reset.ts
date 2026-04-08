// REQ-CLI-017
import { existsSync, unlinkSync, readdirSync, mkdirSync, renameSync } from "node:fs";
import { relative, dirname, sep, join, basename } from "node:path";
import { StateManager, removeEmptyDirs } from "../sync/state.js";
import { ConfigManager } from "../config.js";
import { KeychainAdapter } from "../auth/keychain.js";
import { deleteSessionFile } from "../auth/session.js";
import { collectFiles, groupUserFiles, type UserFileGroup } from "../fs/collect.js";
import { selectItem } from "../tui/select.js";
import type { PromptFn } from "../auth/prompt.js";

export interface ResetOptions {
  outputDir: string;
  full?: boolean;
  force?: boolean;
  dryRun?: boolean;
  moveUserFiles?: boolean;
  promptFn?: PromptFn;
}

/**
 * Render a sorted list of absolute paths as a tree relative to `rootDir`.
 *
 * Example output (written to stdout, no trailing newline):
 *   Course_A/
 *   ├── Section_1/
 *   │   ├── file.pdf
 *   │   └── file.description.md
 *   └── Section_2/
 *       └── doc.url.txt
 */
function renderTree(paths: string[], rootDir: string): string {
  // Build a nested map: segment[] → children map
  type Tree = Map<string, Tree>;

  const root: Tree = new Map();

  for (const p of paths) {
    const rel = relative(rootDir, p);
    const parts = rel.split(sep);
    let node = root;
    for (const part of parts) {
      if (!node.has(part)) node.set(part, new Map());
      node = node.get(part)!;
    }
  }

  const lines: string[] = [];

  function walk(node: Tree, prefix: string): void {
    const entries = [...node.entries()];
    entries.forEach(([name, children], idx) => {
      const isLast = idx === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const hasChildren = children.size > 0;
      lines.push(prefix + connector + name + (hasChildren ? "/" : ""));
      if (hasChildren) {
        walk(children, prefix + (isLast ? "    " : "│   "));
      }
    });
  }

  // Top-level entries (no prefix)
  const topEntries = [...root.entries()];
  topEntries.forEach(([name, children], idx) => {
    const isLast = idx === topEntries.length - 1;
    const hasChildren = children.size > 0;
    lines.push(name + (hasChildren ? "/" : ""));
    if (hasChildren) {
      walk(children, isLast ? "    " : "│   ");
    }
  });

  return lines.join("\n");
}

type MoveTarget = "output-root" | `parent:${string}` | `custom:${string}` | "skip";

/** Build select options for a user file group. */
function buildMoveOptions(
  group: UserFileGroup,
  outputDir: string,
): Array<{ label: string; value: MoveTarget }> {
  const name = basename(group.absPath);
  const options: Array<{ label: string; value: MoveTarget }> = [];

  // outputDir root option (only if group is not already directly in outputDir)
  const parentDir = dirname(group.absPath);
  if (parentDir !== outputDir) {
    options.push({
      label: `[outputDir root] → ${join(outputDir, name)}`,
      value: "output-root",
    });
  }

  // Parent folder options — each ancestor between outputDir and the group
  const relToOutput = relative(outputDir, group.absPath);
  const parts = relToOutput.split(sep);
  // Parts[0] is the top-level dir. Offer parent choices for levels 2..n-1
  for (let i = 1; i < parts.length; i++) {
    const parentPath = join(outputDir, ...parts.slice(0, i));
    if (parentPath !== outputDir) {
      options.push({
        label: `[parent: ${parts.slice(0, i).join("/")}] → ${join(parentPath, name)}`,
        value: `parent:${parentPath}`,
      });
    }
  }

  options.push({ label: "[custom path] → enter a path", value: "custom:" as MoveTarget });
  options.push({ label: "[skip] → leave in place", value: "skip" });

  return options;
}

/** Move a group (file or directory) to targetDir. Returns the new path or null on failure. */
function moveGroup(group: UserFileGroup, targetDir: string): string | null {
  const name = basename(group.absPath);
  const dest = join(targetDir, name);
  try {
    mkdirSync(targetDir, { recursive: true });
    renameSync(group.absPath, dest);
    return dest;
  } catch {
    return null;
  }
}

/** Handle the --move-user-files flow. Returns number of groups moved. */
async function handleMoveUserFiles(
  outputDir: string,
  knownPaths: string[],
  dryRun: boolean,
  promptFn: PromptFn | undefined,
): Promise<number> {
  const fallbackPrompt: PromptFn = promptFn ?? (async (p) => {
    process.stdout.write(p);
    return "";
  });

  const allOnDisk = collectFiles(outputDir);
  const knownSet = new Set(knownPaths.map((p) => p.normalize("NFC")));
  const userFiles = allOnDisk.filter((f) => !knownSet.has(f));

  if (userFiles.length === 0) return 0;

  const groups = groupUserFiles(userFiles, outputDir);

  if (dryRun) {
    process.stdout.write(`\n[dry-run] User-managed items (${userFiles.length} files in ${groups.length} group${groups.length === 1 ? "" : "s"}):\n`);
    const treeOut = renderTree(userFiles.sort(), outputDir);
    if (treeOut) process.stdout.write("\n" + treeOut + "\n");
    return 0;
  }

  process.stdout.write(`\nDetected ${groups.length} user-managed item${groups.length === 1 ? "" : "s"} in your output folder:\n`);
  // Show tree of all user files
  const treeOut = renderTree(userFiles.sort(), outputDir);
  if (treeOut) process.stdout.write("\n" + treeOut + "\n");
  process.stdout.write("\nFor each item, choose what to do:\n\n");

  let movedCount = 0;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const suffix = group.isDirectory ? "/" : "";
    const title = `[${i + 1}/${groups.length}] ${group.displayPath}${suffix}`;

    const options = buildMoveOptions(group, outputDir);
    const choice = await selectItem({ title, items: options, promptFn: fallbackPrompt });

    let targetDir: string | null = null;

    if (choice === "output-root") {
      targetDir = outputDir;
    } else if (choice.startsWith("parent:")) {
      targetDir = choice.slice("parent:".length);
    } else if (choice.startsWith("custom:")) {
      const customPath = await fallbackPrompt("Enter target directory path: ");
      targetDir = customPath.trim() || null;
    }
    // "skip" → targetDir stays null

    if (targetDir) {
      const dest = moveGroup(group, targetDir);
      if (dest) {
        process.stdout.write(`Moved: ${group.displayPath}${suffix} → ${dest}\n`);
        movedCount++;
      } else {
        process.stdout.write(`Failed to move ${group.displayPath} — leaving in place.\n`);
      }
    }
  }

  const skipped = groups.length - movedCount;
  process.stdout.write(`\nMoved ${movedCount}, skipped ${skipped}. Now deleting scraper files...\n`);

  return movedCount;
}

export async function runReset(opts: ResetOptions): Promise<void> {
  const { outputDir, full = false, force = false, dryRun = false, moveUserFiles = false, promptFn } = opts;

  const sm = new StateManager(outputDir);
  const state = await sm.load();

  if (!state) {
    process.stdout.write("Nothing to reset.\n");
    return;
  }

  // Collect all scraper-owned file paths from state (including sidecars and generated files)
  const knownPaths: string[] = [];
  let generatedCount = 0;
  let sidecarCount = 0;
  let submissionCount = 0;
  let imageCount = 0;
  let activityCount = 0;
  for (const p of state.generatedFiles ?? []) { knownPaths.push(p); generatedCount++; }
  for (const course of Object.values(state.courses)) {
    for (const section of Object.values(course.sections ?? {})) {
      for (const file of Object.values(section.files ?? {})) {
        if (file.localPath) { knownPaths.push(file.localPath); activityCount++; }
        if (file.sidecarPath) { knownPaths.push(file.sidecarPath); sidecarCount++; }
        for (const sp of file.submissionPaths ?? []) { knownPaths.push(sp); submissionCount++; }
        for (const ip of file.imagePaths ?? []) { knownPaths.push(ip); imageCount++; }
      }
    }
  }
  const courseCount = Object.keys(state.courses).length;

  // Confirmation prompt (unless --force or --dry-run)
  if (!force && !dryRun && promptFn) {
    const scope = full
      ? "all scraped files, sync state, config, and stored credentials"
      : "all scraped files and sync state";
    process.stdout.write(`This will delete ${scope}.\n`);
    process.stdout.write(`Your personal files in ${outputDir} will be kept.\n`);
    const answer = await promptFn("Continue? [y/N] ");
    if (answer.trim().toLowerCase() !== "y") return;
  }

  // --move-user-files: interactively move user-owned files before deletion
  if (moveUserFiles) {
    await handleMoveUserFiles(outputDir, knownPaths, dryRun, promptFn);
  }

  // Delete scraper-owned files (deduplicate first to avoid ENOENT on duplicate state entries)
  let deletedCount = 0;
  const existingPaths = [...new Set(knownPaths)].filter((p) => existsSync(p));

  if (dryRun) {
    const treeOutput = renderTree(existingPaths.sort(), outputDir);
    // Build a categorised summary so the count is reconcilable with msc scrape output
    const parts: string[] = [`${activityCount} activit${activityCount === 1 ? "y" : "ies"}`];
    if (sidecarCount > 0) parts.push(`${sidecarCount} sidecar${sidecarCount === 1 ? "" : "s"}`);
    if (submissionCount > 0) parts.push(`${submissionCount} submission${submissionCount === 1 ? "" : "s"}`);
    if (imageCount > 0) parts.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
    if (generatedCount > 0) parts.push(`${generatedCount} generated`);
    process.stdout.write(`[dry-run] Would delete ${existingPaths.length} files across ${courseCount} courses (${parts.join(", ")}):\n`);
    if (treeOutput) {
      process.stdout.write("\n" + treeOutput + "\n");
    }
    process.stdout.write(`\n+ state file: ${relative(outputDir, sm.statePath)}\n`);
    if (full) {
      process.stdout.write("+ config reset\n");
      process.stdout.write("+ credentials and session cleared\n");
    }
    return;
  }

  for (const p of existingPaths) {
    unlinkSync(p);
    deletedCount++;
  }

  // Remove empty directories left behind (deepest-first, recursive)
  const dirs = new Set<string>();
  for (const p of knownPaths) dirs.add(dirname(p));
  const sorted = [...dirs].sort((a, b) => b.length - a.length);
  for (const d of sorted) {
    removeEmptyDirs(d, outputDir);
  }

  // Delete state file
  if (existsSync(sm.statePath)) {
    unlinkSync(sm.statePath);
  }

  // --full: also clear config and credentials
  if (full) {
    const config = new ConfigManager();
    const keychain = new KeychainAdapter();
    await config.reset();
    await keychain.deleteCredentials();
    await deleteSessionFile();
  }

  const suffix = full
    ? " Config and credentials cleared."
    : " Run `msc scrape` to start fresh.";
  const extras: string[] = [];
  if (sidecarCount > 0) extras.push(`${sidecarCount} sidecar${sidecarCount === 1 ? "" : "s"}`);
  if (submissionCount > 0) extras.push(`${submissionCount} submission${submissionCount === 1 ? "" : "s"}`);
  if (imageCount > 0) extras.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
  if (generatedCount > 0) extras.push(`${generatedCount} generated`);
  const breakdown = extras.length > 0 ? ` (incl. ${extras.join(", ")})` : "";
  process.stdout.write(`Deleted ${deletedCount} files${breakdown} across ${courseCount} courses. State reset.${suffix}\n`);
}
