// REQ-CLI-017
import { existsSync, unlinkSync, rmdirSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { StateManager } from "../sync/state.js";
import { ConfigManager } from "../config.js";
import { KeychainAdapter } from "../auth/keychain.js";
import { deleteSessionFile } from "../auth/session.js";
import type { PromptFn } from "../auth/prompt.js";

export interface ResetOptions {
  outputDir: string;
  full?: boolean;
  force?: boolean;
  dryRun?: boolean;
  promptFn?: PromptFn;
}

export async function runReset(opts: ResetOptions): Promise<void> {
  const { outputDir, full = false, force = false, dryRun = false, promptFn } = opts;

  const sm = new StateManager(outputDir);
  const state = await sm.load();

  if (!state) {
    process.stdout.write("Nothing to reset.\n");
    return;
  }

  // Collect all scraper-owned file paths from state
  const knownPaths: string[] = [];
  for (const course of Object.values(state.courses)) {
    for (const section of Object.values(course.sections ?? {})) {
      for (const file of Object.values(section.files ?? {})) {
        if (file.localPath) knownPaths.push(file.localPath);
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

  // Delete scraper-owned files
  let deletedCount = 0;
  for (const p of knownPaths) {
    if (!existsSync(p)) continue;
    if (dryRun) {
      process.stdout.write(`  [dry-run] would delete: ${p}\n`);
    } else {
      unlinkSync(p);
    }
    deletedCount++;
  }

  // Remove empty directories left behind (deepest-first)
  if (!dryRun) {
    const dirs = new Set<string>();
    for (const p of knownPaths) dirs.add(dirname(p));
    const sorted = [...dirs].sort((a, b) => b.length - a.length);
    for (const d of sorted) {
      if (!existsSync(d)) continue;
      try {
        if (readdirSync(d).length === 0) rmdirSync(d);
      } catch { /* ignore — user files may still be present */ }
    }
  }

  // Delete state file
  if (dryRun) {
    process.stdout.write(`  [dry-run] would delete: ${sm.statePath}\n`);
  } else if (existsSync(sm.statePath)) {
    unlinkSync(sm.statePath);
  }

  // --full: also clear config and credentials
  if (full) {
    if (dryRun) {
      process.stdout.write("  [dry-run] would reset config\n");
      process.stdout.write("  [dry-run] would clear credentials and session\n");
    } else {
      const config = new ConfigManager();
      const keychain = new KeychainAdapter();
      await config.reset();
      await keychain.deleteCredentials();
      await deleteSessionFile();
    }
  }

  if (dryRun) {
    process.stdout.write(`\n[dry-run] Would delete ${deletedCount} files across ${courseCount} courses.\n`);
    return;
  }

  const suffix = full
    ? " Config and credentials cleared."
    : " Run `msc scrape` to start fresh.";
  process.stdout.write(`Deleted ${deletedCount} files across ${courseCount} courses. State reset.${suffix}\n`);
}
