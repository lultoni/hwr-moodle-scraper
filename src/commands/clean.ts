// msc clean — delete or move user-added files from output folder
import { existsSync, unlinkSync, mkdirSync, renameSync } from "node:fs";
import { relative, dirname, join, sep } from "node:path";
import { StateManager, removeEmptyDirs } from "../sync/state.js";
import { collectFiles, buildKnownPaths, renderTree, USER_FILES_PROTECTED_DIR } from "../fs/collect.js";
import type { PromptFn } from "../auth/prompt.js";

export interface CleanOptions {
  outputDir: string;
  move?: boolean;
  dryRun?: boolean;
  force?: boolean;
  promptFn?: PromptFn;
}

const USER_FILES_DIR = "User Files";

export async function runClean(opts: CleanOptions): Promise<void> {
  const { outputDir, move = false, dryRun = false, force = false, promptFn } = opts;

  const sm = new StateManager(outputDir);
  const state = await sm.load();

  if (!state) {
    process.stdout.write("No sync history. Run `msc scrape` first.\n");
    return;
  }

  // Build known paths from state and find user-added files
  const knownPaths = buildKnownPaths(state);
  const knownSet = new Set(knownPaths.map((p) => p.normalize("NFC")));
  const allOnDisk = collectFiles(outputDir);
  // Belt-and-suspenders: also exclude _User-Files/ by path check (collectFiles already skips
  // the directory itself, but guard here too in case of edge cases)
  const userFiles = allOnDisk.filter(
    (f) => !knownSet.has(f) && !f.split(sep).includes(USER_FILES_PROTECTED_DIR)
  );

  if (userFiles.length === 0) {
    process.stdout.write("No user-added files found. Your output folder only contains scraper-managed files.\n");
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
      process.stdout.write(`[dry-run] Would move ${userFiles.length} file${userFiles.length === 1 ? "" : "s"} to "${USER_FILES_DIR}/".\n`);
    } else {
      process.stdout.write(`[dry-run] Would delete ${userFiles.length} file${userFiles.length === 1 ? "" : "s"}.\n`);
      process.stdout.write(`  Safer alternative: \`msc clean --move\` relocates files to "${USER_FILES_DIR}/" instead of deleting.\n`);
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
      process.stdout.write("Cancelled.\n");
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
    process.stdout.write(`${actionPast} ${count} file${count === 1 ? "" : "s"} to "${USER_FILES_DIR}/".\n`);
  } else {
    process.stdout.write(`${actionPast} ${count} file${count === 1 ? "" : "s"}.\n`);
  }
}
