// REQ-FS-002, REQ-FS-005, REQ-FS-006, REQ-FS-008
import {
  mkdirSync, existsSync, renameSync, writeFileSync, readFileSync,
  readdirSync, statSync, unlinkSync,
} from "node:fs";
import { join, dirname, sep } from "node:path";
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
  const safeSemester = semesterDir ? sanitiseFilename(semesterDir).replace(/\s+/g, "_") : undefined;
  const dir = safeSemester
    ? join(outputDir, safeSemester, safeCourse, safeSection)
    : join(outputDir, safeCourse, safeSection);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw Object.assign(
      new Error(`Error: output directory ${dir} is not accessible — ${(err as Error).message}.`),
      { exitCode: EXIT_CODES.FILESYSTEM_ERROR }
    );
  }
  const fullPath = join(dir, filename);
  // Defense-in-depth: verify the resolved path is still inside the output directory
  if (!fullPath.startsWith(dir + sep) && fullPath !== dir) {
    throw Object.assign(
      new Error(`Path traversal detected in filename: ${filename}`),
      { exitCode: EXIT_CODES.FILESYSTEM_ERROR }
    );
  }
  return fullPath;
}

/** Atomically write content to destPath and return its SHA-256 hex digest. */
export async function atomicWrite(destPath: string, content: Buffer): Promise<{ hash: string }> {
  const hash = createHash("sha256").update(content).digest("hex");
  // Use a short fixed-name tmp file in the same dir to avoid ENAMETOOLONG when destPath is near 255 bytes
  const tmpPath = join(dirname(destPath), "." + randomBytes(4).toString("hex") + ".tmp");
  writeFileSync(tmpPath, content, { mode: 0o600 });
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
  // Use Node.js native statfs — no shell execution, no injection surface
  const { statfs } = await import("node:fs/promises");
  try {
    const stats = await statfs(dir);
    const availableMb = (Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024);
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
    // If statfs fails for some other reason (e.g. dir doesn't exist yet), skip the check
  }
}

/**
 * Non-throwing variant of checkDiskSpace for periodic use during long scrapes.
 * Returns false if disk space is insufficient, true otherwise (including on check failure).
 */
export async function checkDiskSpaceSafe(dir: string, opts: DiskSpaceOptions): Promise<boolean> {
  try {
    await checkDiskSpace(dir, opts);
    return true;
  } catch {
    return false;
  }
}
