// REQ-CLI-006 (extracted from status.ts)
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

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

/** Recursively collect all file paths under a directory. Skips state and meta files. */
export function collectFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".moodle-scraper-state.json") continue;
    if (entry.name.endsWith(".meta.json")) continue;
    // Normalise to NFC — macOS HFS+/APFS returns NFD filenames from readdir,
    // but the state always stores NFC (paths originate from Moodle HTML).
    // Without this, Set.has() misses umlaut files even when the path is correct.
    const full = join(dir, entry.name).normalize("NFC");
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
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
