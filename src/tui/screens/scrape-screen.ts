/**
 * TUI Scrape-Screen.
 * Step 1: choose scrape mode. Step 2: configure options. Step 3: run.
 */

import { runScrape } from "../../commands/scrape.js";
import { selectItem } from "../select.js";
import { readKey } from "../keys.js";
import type { PromptFn } from "../../auth/prompt.js";

const CLEAR = "\u001b[2J\u001b[H";

export async function scrapeScreen(outputDir: string, promptFn: PromptFn): Promise<void> {
  // ── Step 1: mode ──────────────────────────────────────────────────────────
  process.stdout.write(CLEAR);
  process.stdout.write("─── Scrape ───\n\n");

  const mode = await selectItem({
    title: "Choose scrape mode:",
    items: [
      { label: "Normal — download new and changed files", value: "normal" },
      { label: "Force — re-download everything", value: "force" },
      { label: "Check files — re-download missing files", value: "check" },
      { label: "Dry-run — plan without downloading", value: "dry" },
      { label: "Back to menu", value: "back" },
    ],
    promptFn,
  });

  if (mode === "back") return;

  // Dry-run skips the options sub-menu
  if (mode === "dry") {
    process.stdout.write(CLEAR);
    try {
      await runScrape({ outputDir, dryRun: true, force: false });
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
    }
    if (process.stdin.isTTY) {
      process.stdout.write("\nPress any key to return to menu...\n");
      await readKey();
    }
    return;
  }

  // ── Step 2: options toggles ───────────────────────────────────────────────
  let verbose = false;
  let quiet = false;
  let skipDiskCheck = false;
  let coursesFilter: number[] | undefined;

  while (true) {
    process.stdout.write(CLEAR);
    process.stdout.write("─── Scrape Options ───\n\n");
    process.stdout.write(`  Mode: ${mode}\n\n`);

    const coursesTxt   = coursesFilter ? coursesFilter.join(", ") : "all courses";
    const choice = await selectItem({
      title: "Toggle options, then select → Run:",
      items: [
        { label: `[${verbose ? "x" : " "}] Verbose output`,           value: "verbose" },
        { label: `[${quiet ? "x" : " "}] Quiet (errors only)`,        value: "quiet" },
        { label: `[${skipDiskCheck ? "x" : " "}] Skip disk check`,    value: "disk" },
        { label: `[${coursesFilter ? "x" : " "}] Courses: ${coursesTxt}`, value: "courses" },
        { label: "→ Run",                                               value: "run" },
        { label: "← Back",                                             value: "back" },
      ],
      promptFn,
    });

    if (choice === "back") return;
    if (choice === "run") break;

    if (choice === "verbose") { verbose = !verbose; if (verbose) quiet = false; }
    else if (choice === "quiet") { quiet = !quiet; if (quiet) verbose = false; }
    else if (choice === "disk") { skipDiskCheck = !skipDiskCheck; }
    else if (choice === "courses") {
      if (coursesFilter) {
        coursesFilter = undefined; // toggle off → back to all courses
      } else {
        process.stdout.write("\nCourse IDs (comma-separated, e.g. 12345,67890): ");
        const input = await promptFn("");
        const ids = input.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
        coursesFilter = ids.length > 0 ? ids : undefined;
      }
    }
  }

  // ── Step 3: run ───────────────────────────────────────────────────────────
  process.stdout.write(CLEAR);

  try {
    await runScrape({
      outputDir,
      dryRun: false,
      force: mode === "force",
      checkFiles: mode === "check",
      verbose,
      quiet,
      skipDiskCheck,
      courses: coursesFilter,
      nonInteractive: false,
    });
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
  }

  if (process.stdin.isTTY) {
    process.stdout.write("\nPress any key to return to menu...\n");
    await readKey();
  }
}
