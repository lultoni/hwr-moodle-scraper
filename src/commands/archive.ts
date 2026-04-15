// UC-38: msc archive — remove courses from state without touching disk files
import { StateManager } from "../sync/state.js";
import { matchCourses } from "../scraper/course-filter.js";
import type { PromptFn } from "../auth/prompt.js";

export interface ArchiveOptions {
  outputDir: string;
  courses?: string;    // comma-separated keyword filter
  dryRun?: boolean;
  force?: boolean;
  promptFn?: PromptFn;
}

export async function runArchive(opts: ArchiveOptions): Promise<void> {
  const { outputDir, courses: coursesKeyword, dryRun = false, force = false, promptFn } = opts;

  const sm = new StateManager(outputDir);
  const state = await sm.load();

  if (!state) {
    process.stdout.write("No sync history. Run `msc scrape` first.\n");
    return;
  }

  // Determine which course IDs to archive
  let courseIds: number[];
  if (coursesKeyword) {
    const { ids, unmatched } = matchCourses(coursesKeyword, state);
    if (unmatched.length > 0) {
      process.stderr.write(`[msc] No courses matched: ${unmatched.join(", ")}\n`);
      process.stderr.write("[msc] Available courses:\n");
      for (const c of Object.values(state.courses)) {
        process.stderr.write(`[msc]   • ${c.name}\n`);
      }
    }
    courseIds = ids;
  } else {
    courseIds = Object.keys(state.courses).map(Number);
  }

  if (courseIds.length === 0) {
    process.stdout.write("No courses to archive.\n");
    return;
  }

  const matchedCourses = courseIds.map((id) => ({
    id,
    name: state.courses[String(id)]?.name ?? String(id),
    fileCount: Object.values(state.courses[String(id)]?.sections ?? {})
      .reduce((sum, s) => sum + Object.keys(s.files ?? {}).length, 0),
  }));

  process.stdout.write(`Courses to archive (${matchedCourses.length}):\n`);
  for (const c of matchedCourses) {
    process.stdout.write(`  • ${c.name} (${c.fileCount} files tracked)\n`);
  }

  if (dryRun) {
    process.stdout.write(`\n[dry-run] Would archive ${matchedCourses.length} course${matchedCourses.length === 1 ? "" : "s"}. Files on disk untouched.\n`);
    return;
  }

  if (!force && promptFn) {
    const answer = await promptFn(`\nArchive ${matchedCourses.length} course${matchedCourses.length === 1 ? "" : "s"} from state? Files on disk are untouched. [y/N] `);
    if (answer.trim().toLowerCase() !== "y") {
      process.stdout.write("Cancelled.\n");
      return;
    }
  }

  for (const { id } of matchedCourses) {
    delete (state.courses as Record<string, unknown>)[String(id)];
  }

  await sm.save({ courses: state.courses, generatedFiles: state.generatedFiles ?? [] });
  process.stdout.write(`Archived ${matchedCourses.length} course${matchedCourses.length === 1 ? "" : "s"}. Files on disk untouched.\n`);
}
