#!/usr/bin/env node
// scripts/migrate-links-subfolder.js
//
// Moves all scraper-tracked .url.txt files (and their .webloc/.url companions)
// into _Links/ subfolders at their respective section level.
//
// Background: since Pass 45, URL activities are placed in _Links/ inside each section
// folder to reduce clutter. This script migrates previously-scraped files to the new
// layout and updates .moodle-scraper-state.json accordingly.
//
// Usage:
//   node scripts/migrate-links-subfolder.js [--dry-run] [outputDir]
//
// If outputDir is omitted, reads from ~/.config/moodle-scraper/config.json.
// Exit code: 0 = success (or nothing to migrate), 1 = error

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outputDirArg = args.find((a) => !a.startsWith("--"));

// ---------------------------------------------------------------------------
// Resolve output dir
// ---------------------------------------------------------------------------

let outputDir = outputDirArg;

if (!outputDir) {
  const configFile = join(homedir(), ".config", "moodle-scraper", "config.json");
  if (existsSync(configFile)) {
    try {
      const cfg = JSON.parse(readFileSync(configFile, "utf8"));
      outputDir = cfg.outputDir;
    } catch { /* ignore */ }
  }
}

if (!outputDir) {
  process.stderr.write("Error: outputDir not found. Pass it as an argument or configure via msc config set outputDir <path>.\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------

const stateFile = join(outputDir, ".moodle-scraper-state.json");
if (!existsSync(stateFile)) {
  process.stdout.write("No state file found — nothing to migrate.\n");
  process.exit(0);
}

let state;
try {
  state = JSON.parse(readFileSync(stateFile, "utf8"));
} catch (e) {
  process.stderr.write(`Error: could not parse state file: ${e.message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if the path needs migration (ends in .url.txt and is not in /_Links/) */
function needsMigration(p) {
  return typeof p === "string" && p.endsWith(".url.txt") && !p.includes("/_Links/");
}

/** True if a .webloc or .url (Windows shortcut) path needs migration */
function isNativeShortcutOutsideLinks(p) {
  if (typeof p !== "string") return false;
  if (p.includes("/_Links/")) return false;
  return p.endsWith(".webloc") || (p.endsWith(".url") && !p.endsWith(".url.txt"));
}

/** Insert _Links before the filename segment */
function toLinksPath(p) {
  return join(dirname(p), "_Links", basename(p));
}

/** True if a .description.md sidecar belongs to a url.txt that needs migration */
function isSidecarForUrl(sidecarPath, urlPath) {
  if (typeof sidecarPath !== "string") return false;
  if (sidecarPath.includes("/_Links/")) return false;
  if (!sidecarPath.endsWith(".description.md")) return false;
  // Check that this sidecar is for the specific url.txt being migrated:
  // sidecar name without .description.md must equal url name without .url.txt
  const sidecarBase = basename(sidecarPath, ".description.md");
  const urlBase = basename(urlPath, ".url.txt");
  return sidecarBase === urlBase && dirname(sidecarPath) === dirname(urlPath);
}

// ---------------------------------------------------------------------------
// Collect migrations
// ---------------------------------------------------------------------------

let movedCount = 0;
let skippedCount = 0;
let errorCount = 0;

/**
 * Move a file from oldPath to newPath.
 * If dryRun, just print. If file doesn't exist, update state only.
 */
function migrateFile(oldPath, newPath, label) {
  if (oldPath === newPath) return;
  if (dryRun) {
    process.stdout.write(`[dry-run] would move: ${oldPath}\n           →     ${newPath}\n`);
    movedCount++;
    return;
  }
  try {
    mkdirSync(dirname(newPath), { recursive: true });
    if (existsSync(oldPath)) {
      renameSync(oldPath, newPath);
      process.stdout.write(`moved: ${basename(oldPath)} → .../_Links/${basename(newPath)}\n`);
      movedCount++;
    } else {
      // File not on disk (maybe never downloaded) — update state path only
      process.stdout.write(`note: ${basename(oldPath)} not on disk; state path updated to _Links/ location\n`);
      skippedCount++;
    }
  } catch (e) {
    process.stderr.write(`Error moving ${oldPath}: ${e.message}\n`);
    errorCount++;
  }
}

// Migrate per-file state entries
for (const courseEntry of Object.values(state.courses ?? {})) {
  for (const sectionEntry of Object.values(courseEntry.sections ?? {})) {
    for (const fileState of Object.values(sectionEntry.files ?? {})) {
      if (needsMigration(fileState.localPath)) {
        const newPath = toLinksPath(fileState.localPath);
        migrateFile(fileState.localPath, newPath, "url.txt");
        fileState.localPath = newPath;
      }
      // Sidecar .description.md alongside a .url.txt
      if (fileState.sidecarPath && typeof fileState.localPath === "string" &&
          isSidecarForUrl(fileState.sidecarPath, fileState.localPath.replace("/_Links/", "/"))) {
        const newSidecarPath = toLinksPath(fileState.sidecarPath);
        migrateFile(fileState.sidecarPath, newSidecarPath, "description.md sidecar");
        fileState.sidecarPath = newSidecarPath;
      }
    }
  }
}

// Migrate generatedFiles (.webloc / .url native shortcuts)
if (Array.isArray(state.generatedFiles)) {
  state.generatedFiles = state.generatedFiles.map((p) => {
    if (!isNativeShortcutOutsideLinks(p)) return p;
    const newPath = toLinksPath(p);
    migrateFile(p, newPath, "native shortcut");
    return newPath;
  });
}

// ---------------------------------------------------------------------------
// Save updated state
// ---------------------------------------------------------------------------

if (!dryRun && (movedCount > 0 || skippedCount > 0)) {
  try {
    const tmpPath = stateFile + ".migrate.tmp";
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(tmpPath, stateFile);
    process.stdout.write(`State updated: ${stateFile}\n`);
  } catch (e) {
    process.stderr.write(`Error saving state: ${e.message}\n`);
    process.exit(1);
  }
} else if (dryRun) {
  process.stdout.write("\n[dry-run] State not written.\n");
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const total = movedCount + skippedCount;
if (total === 0 && errorCount === 0) {
  process.stdout.write("Nothing to migrate — all URL files are already in _Links/ subfolders.\n");
} else {
  if (!dryRun) {
    process.stdout.write(`\nMigration complete: ${movedCount} file(s) moved, ${skippedCount} path(s) updated (file not on disk), ${errorCount} error(s).\n`);
  } else {
    process.stdout.write(`\n[dry-run] Would migrate ${movedCount} file(s). Run without --dry-run to apply.\n`);
  }
}

if (errorCount > 0) process.exit(1);
