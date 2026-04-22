// REQ-CLI-006 (extracted from status.ts)
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import picomatch from "picomatch";
import type { State } from "../sync/state.js";

export interface UserFileGroup {
  /** Relative path from outputDir (for display). */
  displayPath: string;
  /** Absolute path to the group root (dir or file). */
  absPath: string;
  /** All files belonging to this group. */
  files: string[];
  /** True if the group root is a directory. */
  isDirectory: boolean;
}

// OS-generated noise files that should never appear as "user-added" files.
const SYSTEM_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".localized"]);

/** Directory name reserved for user-owned files that msc should never touch. */
export const USER_FILES_PROTECTED_DIR = "_User-Files";

/**
 * Built-in glob patterns always excluded from user-files detection, regardless of config.
 * Use POSIX-style forward slashes (picomatch is POSIX-only).
 */
export const DEFAULT_EXCLUDE_PATTERNS = [".claude/**", ".git/**"];

/**
 * Merge the built-in default exclude patterns with user-configured patterns.
 * @param configValue — the raw string from `excludePaths` config (comma-separated)
 */
export function mergedExcludePatterns(configValue: string): string[] {
  const user = configValue.split(",").map((s) => s.trim()).filter(Boolean);
  const all = [...DEFAULT_EXCLUDE_PATTERNS];
  for (const p of user) if (!all.includes(p)) all.push(p);
  return all;
}

/** Recursively collect all file paths under a directory. Skips state, meta, and OS noise files.
 *  Files inside any directory named `_User-Files` are excluded — these are user-owned and
 *  must never appear as "user-added" in msc status or be targeted by msc clean.
 *
 *  @param dir — absolute path to the root directory to scan
 *  @param excludePatterns — POSIX-style glob patterns (relative to dir) to exclude.
 *    Pass the result of `mergedExcludePatterns(configValue)` to apply both built-in
 *    defaults and user-configured patterns. An empty array means no exclusions.
 */
export function collectFiles(dir: string, excludePatterns: string[] = []): string[] {
  // Build a single picomatch tester for all patterns (lazy — only created if patterns exist).
  // dot:true is required so dotfiles and dotdirs (e.g. .claude/, .git/) are matched.
  const isExcluded = excludePatterns.length > 0 ? picomatch(excludePatterns, { dot: true }) : null;

  function _collect(currentDir: string): string[] {
    const results: string[] = [];
    if (!existsSync(currentDir)) return results;
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === ".moodle-scraper-state.json") continue;
      if (entry.name === ".moodle-scraper-state.json.bak") continue;
      if (entry.name.endsWith(".meta.json")) continue;
      if (SYSTEM_FILES.has(entry.name)) continue;
      // Skip _User-Files directories entirely — contents are protected user data
      if (entry.isDirectory() && entry.name === USER_FILES_PROTECTED_DIR) continue;
      // Normalise to NFC — macOS HFS+/APFS returns NFD filenames from readdir,
      // but the state always stores NFC (paths originate from Moodle HTML).
      // Without this, Set.has() misses umlaut files even when the path is correct.
      const full = join(currentDir, entry.name).normalize("NFC");
      // Check glob exclusions: convert to POSIX-style relative path before matching.
      // picomatch is POSIX-only; on Windows path.sep is '\' so we normalize to '/'.
      if (isExcluded) {
        const relPosix = relative(dir, full).split(sep).join("/");
        if (isExcluded(relPosix)) continue;
      }
      if (entry.isDirectory()) {
        results.push(..._collect(full));
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
    return results;
  }

  return _collect(dir);
}

/**
 * Group user-owned files by their top-level directory under outputDir.
 *
 * Files directly in outputDir become individual single-file groups.
 * Files deeper than one level are grouped by their first path segment
 * relative to outputDir.
 */
export function groupUserFiles(userFiles: string[], outputDir: string): UserFileGroup[] {
  const buckets = new Map<string, string[]>();

  for (const f of userFiles) {
    const rel = relative(outputDir, f);
    const parts = rel.split(sep);
    // Top-level segment = first path component (either the file name itself or a dir)
    const topLevel = parts[0] ?? rel;
    const list = buckets.get(topLevel) ?? [];
    list.push(f);
    buckets.set(topLevel, list);
  }

  const groups: UserFileGroup[] = [];
  for (const [topLevel, files] of buckets) {
    const absPath = join(outputDir, topLevel);
    // Is a directory group if any file is more than one level deep
    const isDirectory = files.some((f) => {
      const rel = relative(outputDir, f);
      return rel.split(sep).length > 1;
    });
    groups.push({
      displayPath: topLevel,
      absPath,
      files,
      isDirectory,
    });
  }

  return groups;
}

/**
 * Build a flat list of all scraper-owned file paths from a State object.
 * Includes: activity localPaths, sidecarPaths, submissionPaths, imagePaths,
 * and generatedFiles (README.md, _SectionDescription.md, etc.).
 *
 * Used by status, clean, and reset to distinguish scraper files from user files.
 */
export function buildKnownPaths(state: State): string[] {
  const paths: string[] = [];
  for (const p of state.generatedFiles ?? []) paths.push(p);
  for (const course of Object.values(state.courses)) {
    for (const section of Object.values(course.sections ?? {})) {
      for (const file of Object.values(section.files ?? {})) {
        if (file.localPath) paths.push(file.localPath);
        if (file.sidecarPath) paths.push(file.sidecarPath);
        for (const sp of file.submissionPaths ?? []) paths.push(sp);
        for (const ip of file.imagePaths ?? []) paths.push(ip);
      }
    }
  }
  return paths;
}

/**
 * Render a sorted list of absolute paths as a tree relative to `rootDir`.
 *
 * Example output:
 *   Course_A/
 *   ├── Section_1/
 *   │   ├── file.pdf
 *   │   └── file.description.md
 *   └── Section_2/
 *       └── doc.url.txt
 */
export function renderTree(paths: string[], rootDir: string): string {
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
