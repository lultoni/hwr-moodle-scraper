// REQ-CLI-006, REQ-CLI-012, REQ-CLI-016
import { existsSync } from "node:fs";
import { StateManager } from "../sync/state.js";

export interface StatusOptions {
  outputDir: string;
  showIssues?: boolean;
}

export async function runStatus(opts: StatusOptions): Promise<void> {
  const { outputDir, showIssues = false } = opts;
  const sm = new StateManager(outputDir);
  const state = await sm.load();

  if (!state) {
    process.stdout.write("No sync history. Run 'scrape' to start.\n");
    return;
  }

  let totalFiles = 0;
  let orphanedFiles = 0;
  const orphans: Array<{ localPath: string; url: string }> = [];
  const missingFiles: Array<{ localPath: string; url: string }> = [];

  for (const course of Object.values(state.courses)) {
    for (const section of Object.values(course.sections ?? {})) {
      for (const file of Object.values(section.files ?? {})) {
        totalFiles++;
        if (file.status === "orphan") {
          orphanedFiles++;
          orphans.push({ localPath: file.localPath, url: file.url });
        } else if (showIssues && file.localPath && !existsSync(file.localPath)) {
          missingFiles.push({ localPath: file.localPath, url: file.url });
        }
      }
    }
  }

  process.stdout.write(`Last sync: ${state.lastSyncAt}\n`);
  process.stdout.write(`Courses: ${Object.keys(state.courses).length}\n`);
  process.stdout.write(`Files: ${totalFiles}\n`);
  process.stdout.write(`Orphaned: ${orphanedFiles}\n`);

  if (showIssues && orphans.length > 0) {
    process.stdout.write("\nOrphaned files:\n");
    for (const o of orphans) {
      process.stdout.write(`  ${o.localPath} (last known: ${o.url})\n`);
    }
  }

  if (showIssues && missingFiles.length > 0) {
    process.stdout.write("\nMissing files (in state but not on disk):\n");
    for (const m of missingFiles) {
      process.stdout.write(`  ${m.localPath} (source: ${m.url})\n`);
    }
  }
}
