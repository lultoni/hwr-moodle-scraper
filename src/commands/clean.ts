// msc clean — delete or move user-added files from output folder
import { existsSync, unlinkSync, mkdirSync, renameSync } from "node:fs";
import { relative, dirname, join, sep } from "node:path";
import { StateManager, removeEmptyDirs } from "../sync/state.js";
import { collectFiles, buildKnownPaths, renderTree, findEmptyOrphanDirs, USER_FILES_PROTECTED_DIR } from "../fs/collect.js";
import type { PromptFn } from "../auth/prompt.js";
import { ui } from "../ui.js";

export interface CleanOptions {
  outputDir: string;
  move?: boolean;
  dryRun?: boolean;
  force?: boolean;
  /** Remove empty orphan directories instead of user files. */
  emptyDirs?: boolean;
  promptFn?: PromptFn;
  /** Merged exclude patterns (built-in defaults + user config). From mergedExcludePatterns(). */
  excludePatterns?: string[];
  /** Test injection: override findEmptyOrphanDirs implementation. */
  _findEmptyOrphanDirs?: (dir: string, patterns?: string[]) => string[];
}

const USER_FILES_DIR = "User Files";

export async function runClean(opts: CleanOptions): Promise<void> {
  const { outputDir, move = false, dryRun = false, force = false, promptFn, excludePatterns = [], emptyDirs = false } = opts;
  const findEmptyFn = opts._findEmptyOrphanDirs ?? findEmptyOrphanDirs;

  const sm = new StateManager(outputDir);
  const state = await sm.load();

  if (!state) {
    ui.info("No sync history. Run `msc scrape` first.");
    return;
  }

  // --empty-dirs mode: remove empty orphan directories
  if (emptyDirs) {
    const dirs = findEmptyFn(outputDir, excludePatterns);
    if (dirs.length === 0) {
      ui.success("No empty orphan directories found.");
      return;
    }
    if (dryRun) {
      process.stdout.write(`\nEmpty orphan directories (${dirs.length}):\n\n`);
      for (const d of dirs) process.stdout.write(`  ${d}\n`);
      process.stdout.write("\n");
      ui.info(`[dry-run] Would remove ${dirs.length} empty director${dirs.length === 1 ? "y" : "ies"}.`);
      return;
    }
    let count = 0;
    for (const d of dirs) {
      removeEmptyDirs(d, outputDir);
      count++;
    }
    ui.success(`Removed ${count} empty director${count === 1 ? "y" : "ies"}.`);
    return;
  }

  // Build known paths from state and find user-added files
  const knownPaths = buildKnownPaths(state);
  const knownSet = new Set(knownPaths.map((p) => p.normalize("NFC")));
  const allOnDisk = collectFiles(outputDir, excludePatterns);
  // Belt-and-suspenders: also exclude _User-Files/ by path check (collectFiles already skips
  // the directory itself, but guard here too in case of edge cases)
  const userFiles = allOnDisk.filter(
    (f) => !knownSet.has(f) && !f.split(sep).includes(USER_FILES_PROTECTED_DIR)
  );

  if (userFiles.length === 0) {
    ui.success("No user-added files found. Your output folder only contains scraper-managed files.");
    return;
  }

  const sorted = userFiles.sort();
  const action = move ? "move" : "delete";
  const actionPast = move ? "Moved" : "Deleted";

  // Show tree
  const treeOut = renderTree(sorted, outputDir);
  process.stdout.write(`\nUser-added files (${userFiles.length}):\n\n`);
  if (treeOut) process.stdout.write(treeOut + "\n\n");

  if (dryRun) {
    if (move) {
      ui.info(`[dry-run] Would move ${userFiles.length} file${userFiles.length === 1 ? "" : "s"} to "${USER_FILES_DIR}/".`);
    } else {
      ui.info(`[dry-run] Would delete ${userFiles.length} file${userFiles.length === 1 ? "" : "s"}.`);
      ui.hint(`  Safer alternative: \`msc clean --move\` relocates files to "${USER_FILES_DIR}/" instead of deleting.`);
    }
    return;
  }

  // Confirmation (unless --force)
  if (!force && promptFn) {
    const prompt = move
      ? `Move ${userFiles.length} file${userFiles.length === 1 ? "" : "s"} to "${USER_FILES_DIR}/"? [y/N] `
      : `Delete ${userFiles.length} file${userFiles.length === 1 ? "" : "s"}? [y/N] `;
    const answer = await promptFn(prompt);
    if (answer.trim().toLowerCase() !== "y") {
      ui.info("Cancelled.");
      return;
    }
  }

  let count = 0;
  const dirsToClean = new Set<string>();

  if (move) {
    // Move each file preserving relative path under "User Files/"
    const targetRoot = join(outputDir, USER_FILES_DIR);
    for (const f of sorted) {
      const rel = relative(outputDir, f);
      const dest = join(targetRoot, rel);
      const destDir = dirname(dest);
      try {
        mkdirSync(destDir, { recursive: true });
        renameSync(f, dest);
        dirsToClean.add(dirname(f));
        count++;
      } catch {
        process.stderr.write(`Failed to move: ${rel}\n`);
      }
    }
  } else {
    // Delete each file
    for (const f of sorted) {
      try {
        unlinkSync(f);
        dirsToClean.add(dirname(f));
        count++;
      } catch {
        const rel = relative(outputDir, f);
        process.stderr.write(`Failed to delete: ${rel}\n`);
      }
    }
  }

  // Clean up empty directories (deepest first)
  const dirsSorted = [...dirsToClean].sort((a, b) => b.length - a.length);
  for (const d of dirsSorted) {
    removeEmptyDirs(d, outputDir);
  }

  if (move) {
    ui.success(`${actionPast} ${count} file${count === 1 ? "" : "s"} to "${USER_FILES_DIR}/".`);
  } else {
    ui.success(`${actionPast} ${count} file${count === 1 ? "" : "s"}.`);
  }
}
