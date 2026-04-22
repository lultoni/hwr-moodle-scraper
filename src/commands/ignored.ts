// msc ignored — show all actively-ignored paths: exclude patterns, _User-Files dirs, User Files/
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ConfigManager } from "../config.js";
import { DEFAULT_EXCLUDE_PATTERNS, USER_FILES_PROTECTED_DIR } from "../fs/collect.js";

export interface IgnoredOptions {
  outputDir: string;
}

/**
 * Recursively find all directories named `_User-Files` under a root directory.
 * Returns their absolute paths.
 */
function findUserFilesDirs(dir: string): string[] {
  const found: string[] = [];
  if (!existsSync(dir)) return found;
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === USER_FILES_PROTECTED_DIR) {
      found.push(join(dir, entry.name));
    } else {
      // Skip .moodle-scraper-state hidden dir and other dot-dirs for performance
      if (!entry.name.startsWith(".")) {
        found.push(...findUserFilesDirs(join(dir, entry.name)));
      }
    }
  }
  return found;
}

function write(s: string): void {
  process.stdout.write(s + "\n");
}

export async function runIgnored(opts: IgnoredOptions): Promise<void> {
  const { outputDir } = opts;
  const cfg = new ConfigManager();
  const rawExcludePaths = ((await cfg.get("excludePaths")) as string) ?? "";

  const userPatterns = rawExcludePaths
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !DEFAULT_EXCLUDE_PATTERNS.includes(s));

  // ── Section 1: Exclude patterns ──────────────────────────────────────────
  write("Exclude patterns (excluded from user-files detection):");
  write("");
  write("  Built-in defaults (always active):");
  for (const p of DEFAULT_EXCLUDE_PATTERNS) {
    write(`    * ${p}`);
  }
  if (userPatterns.length > 0) {
    write("");
    write("  Custom (from config excludePaths):");
    for (const p of userPatterns) {
      write(`    + ${p}`);
    }
  } else {
    write("");
    write("  Custom: none  (add with: msc config set excludePaths \"my-folder/**\")");
  }

  // ── Section 2: _User-Files directories ───────────────────────────────────
  write("");
  write(`Protected directories (\"${USER_FILES_PROTECTED_DIR}\" — contents never shown or deleted):`);
  write("");

  const protectedDirs = findUserFilesDirs(outputDir);
  if (protectedDirs.length === 0) {
    write(`  None found under ${outputDir}`);
    write(`  (Create a folder named "_User-Files" anywhere in your output dir to protect it)`);
  } else {
    for (const d of protectedDirs) {
      const rel = relative(outputDir, d).split(sep).join("/");
      write(`  ${rel}/`);
    }
  }

  // ── Section 3: User Files/ (relocated by msc clean --move) ───────────────
  write("");
  const userFilesDir = join(outputDir, "User Files");
  if (existsSync(userFilesDir)) {
    write(`Relocated files directory ("User Files/" — managed by msc clean --move):`);
    write(`  ${userFilesDir}`);
  } else {
    write(`Relocated files directory ("User Files/"): not present`);
    write(`  (Created by: msc clean --move)`);
  }
}
