// REQ-FS-002, REQ-FS-005, REQ-FS-006, REQ-FS-008
import {
  mkdirSync, existsSync, renameSync, writeFileSync, readFileSync,
  readdirSync, statSync, unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { sanitiseFilename } from "./sanitise.js";
import { EXIT_CODES } from "../exit-codes.js";
import type { Logger } from "../logger.js";

export interface OutputPathOptions {
  outputDir: string;
  semesterDir?: string;  // Optional semester grouping folder (e.g. "Semester_3")
  courseName: string;
  sectionName: string;
  filename: string;
}

export async function buildOutputPath(opts: OutputPathOptions): Promise<string> {
  const { outputDir, semesterDir, courseName, sectionName, filename } = opts;
  // Sanitise names and also replace spaces with _ for directory names
  const safeCourse = sanitiseFilename(courseName).replace(/\s+/g, "_");
  const safeSection = sanitiseFilename(sectionName).replace(/\s+/g, "_");
  const dir = semesterDir
    ? join(outputDir, semesterDir, safeCourse, safeSection)
    : join(outputDir, safeCourse, safeSection);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw Object.assign(
      new Error(`Error: output directory ${dir} is not accessible — ${(err as Error).message}.`),
      { exitCode: EXIT_CODES.FILESYSTEM_ERROR }
    );
  }
  return join(dir, filename);
}

/** Atomically write content to destPath and return its SHA-256 hex digest. */
export async function atomicWrite(destPath: string, content: Buffer): Promise<{ hash: string }> {
  const hash = createHash("sha256").update(content).digest("hex");
  const tmpPath = destPath + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, destPath);
  return { hash };
}

/** Compute the SHA-256 hex digest of an on-disk file. Returns "" on read error. */
export function computeFileHash(filePath: string): string {
  try {
    const content = readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "";
  }
}

export async function cleanPartialFiles(dir: string, logger?: Logger): Promise<void> {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await cleanPartialFiles(fullPath, logger);
    } else if (entry.name.endsWith(".tmp")) {
      unlinkSync(fullPath);
      logger?.warn(`Removed partial file: ${fullPath}`);
    }
  }
}

export interface DiskSpaceOptions {
  minFreeMb: number;
}

export async function checkDiskSpace(dir: string, opts: DiskSpaceOptions): Promise<void> {
  // Use statvfs via child_process df on macOS
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync(`df -k "${dir}"`, { encoding: "utf8", stdio: "pipe" });
    const lines = out.trim().split("\n");
    const parts = (lines[1] ?? "").split(/\s+/);
    // df -k: columns are Filesystem, 1K-blocks, Used, Available, Capacity, Mounted
    const availableKb = parseInt(parts[3] ?? "0", 10);
    const availableMb = availableKb / 1024;
    if (availableMb < opts.minFreeMb) {
      throw Object.assign(
        new Error(
          `Error: insufficient disk space — ${availableMb.toFixed(0)} MB available, ${opts.minFreeMb} MB required.`
        ),
        { exitCode: EXIT_CODES.FILESYSTEM_ERROR }
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException & { exitCode?: number }).exitCode === EXIT_CODES.FILESYSTEM_ERROR) throw err;
    // If df fails for some other reason, skip the check
  }
}
