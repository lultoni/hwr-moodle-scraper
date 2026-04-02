// REQ-SYNC-001, REQ-SYNC-002, REQ-SEC-007
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmdirSync, renameSync as fsRenameSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { renameSync } from "node:fs";
import { sanitiseFilename } from "../fs/sanitise.js";

export interface FileState {
  name: string;
  url: string;
  localPath: string;
  hash: string;
  lastModified: string;
  status: "ok" | "orphan" | "error";
}

export interface SectionState {
  files: Record<string, FileState>;
}

export interface CourseState {
  name: string;
  sections: Record<string, SectionState>;
}

export interface State {
  version: number;
  lastSyncAt: string;
  courses: Record<string, CourseState>;
}

export type PartialState = { courses: Record<string, Partial<CourseState>> };

export class StateManager {
  readonly statePath: string;

  constructor(outputDir: string) {
    this.statePath = join(outputDir, ".moodle-scraper-state.json");
  }

  async load(): Promise<State | null> {
    if (!existsSync(this.statePath)) return null;
    try {
      const raw = readFileSync(this.statePath, "utf8");
      return JSON.parse(raw) as State;
    } catch {
      process.stderr.write("Warning: state file corrupt — starting fresh sync.\n");
      return null;
    }
  }

  async save(data: PartialState): Promise<void> {
    const state: State = {
      version: 1,
      lastSyncAt: new Date().toISOString(),
      courses: data.courses as Record<string, CourseState>,
    };
    mkdirSync(join(this.statePath, ".."), { recursive: true });
    const tmpPath = this.statePath + "." + randomBytes(4).toString("hex") + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    renameSync(tmpPath, this.statePath);
  }
}

/**
 * Silently migrate state file localPath entries from old long course-name paths
 * to the new semester-grouped short-name paths.
 *
 * For each file in state:
 *   - If localPath already starts with outputDir/semesterDir/shortName → skip (already migrated)
 *   - Otherwise: reconstruct new path by replacing the old first-level course folder
 *     with semesterDir/shortName, keeping the section+filename suffix intact
 *   - If new path exists on disk → update localPath
 *   - If old path still exists (not yet re-downloaded) → keep old localPath
 *   - If neither exists → keep old localPath (will be re-downloaded naturally)
 *
 * Returns the (potentially modified) state. Caller is responsible for saving if changed.
 */
export function migrateStatePaths(
  state: State,
  outputDir: string,
  courseShortPaths: Map<string, { semesterDir: string; shortName: string }>,
): { state: State; changed: boolean } {
  let anyChanged = false;
  const normalizedOutputDir = outputDir.endsWith(sep) ? outputDir : outputDir + sep;

  for (const [courseId, courseState] of Object.entries(state.courses)) {
    const shortPath = courseShortPaths.get(courseId);
    if (!shortPath) continue;

    const safeCourse = sanitiseFilename(shortPath.shortName).replace(/\s+/g, "_");
    const newCoursePrefix = join(outputDir, shortPath.semesterDir, safeCourse) + sep;
    const oldExpectedPrefix = join(outputDir, shortPath.semesterDir, safeCourse);

    for (const sectionState of Object.values(courseState.sections ?? {})) {
      for (const fileState of Object.values(sectionState.files ?? {})) {
        const lp = fileState.localPath;
        if (!lp) continue;

        // Already migrated — path already starts with the new semester/shortName prefix
        if (lp.startsWith(newCoursePrefix) || lp === oldExpectedPrefix) continue;

        // Not under outputDir at all — skip
        if (!lp.startsWith(normalizedOutputDir) && !lp.startsWith(outputDir + "/")) continue;

        // Extract the relative path after outputDir + first segment (old course folder name)
        const relToOutput = relative(outputDir, lp);
        const parts = relToOutput.split(sep);
        if (parts.length < 2) continue;  // no section/file segments
        // parts[0] = old course folder, parts[1..] = section/file
        const suffix = parts.slice(1).join(sep);
        const newPath = join(outputDir, shortPath.semesterDir, safeCourse, suffix);

        if (existsSync(newPath)) {
          fileState.localPath = newPath;
          anyChanged = true;
        }
        // else: keep old path; file will be re-downloaded to new path on next run
      }
    }
  }

  return { state, changed: anyChanged };
}

/**
 * Remove empty directories recursively, starting from the deepest level.
 * Stops at `stopDir` — never removes `stopDir` itself or any ancestor.
 */
export function removeEmptyDirs(dir: string, stopDir: string): void {
  if (dir === stopDir || !dir.startsWith(stopDir)) return;
  if (!existsSync(dir)) return;
  try {
    const entries = readdirSync(dir);
    if (entries.length === 0) {
      rmdirSync(dir);
      // Recurse upward
      removeEmptyDirs(dirname(dir), stopDir);
    }
  } catch {
    // ignore errors (e.g. permission denied)
  }
}

/**
 * Physically move files from old localPaths to new localPaths when the state contains
 * paths that no longer match the expected layout (e.g. after changing skPlacement).
 *
 * Strategy: find the safeCourse folder name within the existing localPath, then reconstruct
 * the expected path using the new semesterDir. Only moves files that actually exist on disk.
 *
 * Returns { state, changed } — caller is responsible for saving state if changed.
 */
export function relocateFiles(
  state: State,
  outputDir: string,
  courseShortPaths: Map<string, { semesterDir: string; shortName: string }>,
): { state: State; changed: boolean } {
  let anyChanged = false;
  const movedFrom = new Set<string>();

  for (const [courseId, courseState] of Object.entries(state.courses)) {
    const shortPath = courseShortPaths.get(courseId);
    if (!shortPath) continue;

    const safeCourse = sanitiseFilename(shortPath.shortName).replace(/\s+/g, "_");
    // Expected base dir under outputDir
    const expectedCourseDir = join(outputDir, ...shortPath.semesterDir.split("/"), safeCourse);

    for (const sectionState of Object.values(courseState.sections ?? {})) {
      for (const fileState of Object.values(sectionState.files ?? {})) {
        const lp = fileState.localPath;
        if (!lp || !existsSync(lp)) continue;

        // Find the course folder in the existing path.
        // The path looks like: <outputDir>/<oldSemesterDirs>/<safeCourse>/<section>/<file>
        // We locate safeCourse by splitting relative path and finding its position.
        const relToOutput = relative(outputDir, lp);
        const parts = relToOutput.split(sep);

        // Find the index of the course folder (safeCourse) in parts
        const courseIdx = parts.indexOf(safeCourse);
        if (courseIdx < 0) continue;

        // suffix = everything after the course folder
        const suffix = parts.slice(courseIdx + 1).join(sep);
        if (!suffix) continue;

        const expectedPath = join(expectedCourseDir, suffix);
        if (expectedPath === lp) continue;

        // Move the file
        try {
          mkdirSync(dirname(expectedPath), { recursive: true });
          fsRenameSync(lp, expectedPath);
          movedFrom.add(dirname(lp));
          fileState.localPath = expectedPath;
          anyChanged = true;
        } catch {
          // If rename fails (e.g. cross-device), skip — file will be re-downloaded
        }
      }
    }
  }

  // Remove directories that became empty after moves
  for (const dir of movedFrom) {
    removeEmptyDirs(dir, outputDir);
  }

  return { state, changed: anyChanged };
}
