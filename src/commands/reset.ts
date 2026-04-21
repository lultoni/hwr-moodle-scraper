// REQ-CLI-017
import { existsSync, unlinkSync, readdirSync, mkdirSync, renameSync, statSync } from "node:fs";
import { relative, dirname, sep, join, basename } from "node:path";
import { StateManager, removeEmptyDirs } from "../sync/state.js";
import { ConfigManager } from "../config.js";
import { tryCreateKeychain } from "../auth/keychain.js";
import { deleteSessionFile } from "../auth/session.js";
import { collectFiles, groupUserFiles, renderTree, type UserFileGroup } from "../fs/collect.js";
import { selectItem } from "../tui/select.js";
import type { PromptFn } from "../auth/prompt.js";
import { ui } from "../ui.js";

export interface ResetOptions {
  outputDir: string;
  /** Delete state file only (old default behaviour). */
  state?: boolean;
  /** Delete state + all scraper-tracked files on disk. */
  files?: boolean;
  /** Clear config file. */
  config?: boolean;
  /** Clear keychain credentials and session cookie. */
  credentials?: boolean;
  /** @deprecated Alias for files+config+credentials. Use those flags directly. */
  full?: boolean;
  force?: boolean;
  dryRun?: boolean;
  moveUserFiles?: boolean;
  promptFn?: PromptFn;
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
    const choice = await selectItem({ appTitle: "HWR Moodle Scraper", version: "", screenTitle: title, items: options, promptFn: fallbackPrompt });

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
  const { outputDir, force = false, dryRun = false, moveUserFiles = false, promptFn } = opts;

  // Resolve flag aliases: --full is an alias for --files --config --credentials
  const deleteFiles = opts.files || opts.full || false;
  const clearConfig = opts.config || opts.full || false;
  const clearCreds = opts.credentials || opts.full || false;
  // --state: explicit state-only flag, or implied when no deletion flags given
  const deleteState = opts.state || deleteFiles || (!clearConfig && !clearCreds);

  const sm = new StateManager(outputDir);
  const state = await sm.load();

  // "Nothing to reset" only when there is truly nothing to do:
  // no state file AND no config/credentials flags were requested.
  if (!state && !clearConfig && !clearCreds) {
    ui.info("Nothing to reset.");
    return;
  }

  const courseCount = state ? Object.keys(state.courses).length : 0;
  let totalFiles = 0;
  if (state) {
    for (const course of Object.values(state.courses)) {
      for (const section of Object.values(course.sections ?? {})) {
        totalFiles += Object.keys(section.files ?? {}).length;
      }
    }
  }

  if (!deleteFiles) {
    // State-only reset (--state or default) — never touches files on disk
    if (dryRun) {
      process.stdout.write(`[dry-run] Would clear state file only. ${totalFiles} tracked files across ${courseCount} courses would remain on disk.\n`);
      if (clearConfig) process.stdout.write("[dry-run] Would also reset config.\n");
      if (clearCreds) process.stdout.write("[dry-run] Would also clear credentials and session.\n");
      return;
    }
    if (!force && promptFn && deleteState) {
      process.stdout.write(`This will clear sync state for ${courseCount} course${courseCount === 1 ? "" : "s"} (${totalFiles} files tracked). Your files on disk will NOT be deleted.\n`);
      const answer = await promptFn("Continue? [y/N] ");
      if (answer.trim().toLowerCase() !== "y") {
        ui.info("Cancelled.");
        return;
      }
    }
    // Delete state files only
    if (deleteState) {
      if (existsSync(sm.statePath)) unlinkSync(sm.statePath);
      if (existsSync(sm.backupPath)) unlinkSync(sm.backupPath);
    }
    // Config / credentials may be cleared independently
    if (clearConfig) {
      const config = new ConfigManager();
      await config.reset();
    }
    if (clearCreds) {
      const keychain = tryCreateKeychain();
      if (keychain) await keychain.deleteCredentials();
      await deleteSessionFile();
    }
    const extras: string[] = [];
    if (clearConfig) extras.push("config reset");
    if (clearCreds) extras.push("credentials cleared");
    const suffix = extras.length > 0 ? ` ${extras.join(", ")}.` : "";
    ui.success(`Sync state cleared. Files untouched.${suffix} Run \`msc scrape\` to rebuild.`);
    return;
  }

  // deleteFiles: collect all scraper-owned paths
  const knownPaths: string[] = [];
  let generatedCount = 0;
  let sidecarCount = 0;
  let submissionCount = 0;
  let imageCount = 0;
  let activityCount = 0;
  if (state) {
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
  }

  const existingPaths = [...new Set(knownPaths)].filter((p) => existsSync(p));
  let totalSize = 0;
  for (const p of existingPaths) {
    try {
      totalSize += statSync(p).size;
    } catch { /* ignore */ }
  }
  const sizeMb = (totalSize / 1_000_000).toFixed(0);
  const sizeGb = (totalSize / 1_000_000_000).toFixed(1);
  const sizeStr = totalSize >= 1_000_000_000 ? `${sizeGb} GB` : `${sizeMb} MB`;

  if (dryRun) {
    const treeOutput = renderTree(existingPaths.sort(), outputDir);
    const parts: string[] = [`${activityCount} activit${activityCount === 1 ? "y" : "ies"}`];
    if (sidecarCount > 0) parts.push(`${sidecarCount} sidecar${sidecarCount === 1 ? "" : "s"}`);
    if (submissionCount > 0) parts.push(`${submissionCount} submission${submissionCount === 1 ? "" : "s"}`);
    if (imageCount > 0) parts.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
    if (generatedCount > 0) parts.push(`${generatedCount} generated`);
    process.stdout.write(`[dry-run] Would delete ${existingPaths.length} files (${sizeStr}) across ${courseCount} courses (${parts.join(", ")}):\n`);
    if (treeOutput) process.stdout.write("\n" + treeOutput + "\n");
    process.stdout.write(`\n+ state file: ${relative(outputDir, sm.statePath)}\n`);
    if (clearConfig) process.stdout.write("+ config reset\n");
    if (clearCreds) process.stdout.write("+ credentials and session cleared\n");
    return;
  }

  // --move-user-files: interactively move user-owned files before deletion
  if (moveUserFiles) {
    await handleMoveUserFiles(outputDir, knownPaths, dryRun, promptFn);
  }

  if (!force && promptFn) {
    ui.warn(`WARNING: This will permanently delete ${existingPaths.length} files (${sizeStr}) across ${courseCount} courses.`);
    ui.info("Note: Files from ended courses may not be re-downloadable.");
    process.stdout.write("Type DELETE to confirm, or press Enter to cancel: ");
    const answer = await promptFn("");
    if (answer.trim() !== "DELETE") {
      ui.info("Cancelled.");
      return;
    }
  }

  // Delete scraper-owned files
  let deletedCount = 0;
  for (const p of existingPaths) {
    unlinkSync(p);
    deletedCount++;
  }

  // Remove empty directories left behind
  const dirs = new Set<string>();
  for (const p of knownPaths) dirs.add(dirname(p));
  const sorted = [...dirs].sort((a, b) => b.length - a.length);
  for (const d of sorted) {
    removeEmptyDirs(d, outputDir);
  }

  // Delete state file and backup
  if (existsSync(sm.statePath)) unlinkSync(sm.statePath);
  if (existsSync(sm.backupPath)) unlinkSync(sm.backupPath);

  // --full: also clear config and credentials (conditional on flags)
  if (clearConfig) {
    const config = new ConfigManager();
    await config.reset();
  }
  if (clearCreds) {
    const keychain = tryCreateKeychain();
    if (keychain) await keychain.deleteCredentials();
    await deleteSessionFile();
  }

  const extras: string[] = [];
  if (sidecarCount > 0) extras.push(`${sidecarCount} sidecar${sidecarCount === 1 ? "" : "s"}`);
  if (submissionCount > 0) extras.push(`${submissionCount} submission${submissionCount === 1 ? "" : "s"}`);
  if (imageCount > 0) extras.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
  if (generatedCount > 0) extras.push(`${generatedCount} generated`);
  const breakdown = extras.length > 0 ? ` (incl. ${extras.join(", ")})` : "";
  const tail: string[] = ["State reset."];
  if (clearConfig) tail.push("Config reset.");
  if (clearCreds) tail.push("Credentials cleared.");
  ui.success(`Deleted ${deletedCount} files${breakdown} across ${courseCount} courses. ${tail.join(" ")}`);
}
