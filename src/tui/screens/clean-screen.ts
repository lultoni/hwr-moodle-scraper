/**
 * TUI Clean-Screen.
 * Deletes or moves user-added files. Always confirms before acting.
 */

import { runClean } from "../../commands/clean.js";
import { selectItem } from "../select.js";
import { showConfirm } from "./scrape-screen.js";
import { readKey } from "../keys.js";
import type { PromptFn } from "../../auth/prompt.js";

const APP_TITLE = "HWR Moodle Scraper";

export async function cleanScreen(outputDir: string, promptFn: PromptFn, version: string): Promise<void> {
  const choice = await selectItem({
    appTitle: APP_TITLE, version,
    screenTitle: "── Clean ──",
    items: [
      { label: "Delete user-added files",                   value: "delete" },
      { label: "Move user-added files to User Files/",      value: "move" },
      { label: "Dry-run — preview what would be affected",  value: "dry" },
      { label: "Back to menu",                              value: "back" },
    ],
    promptFn,
  });

  if (choice === "back") return;

  const cliCmd =
    choice === "delete" ? "msc clean" :
    choice === "move"   ? "msc clean --move" :
                          "msc clean --dry-run";

  if (choice !== "dry") {
    const confirmed = await showConfirm(version, "── Clean — Confirm ──", cliCmd, promptFn);
    if (!confirmed) return;
  }

  process.stdout.write("\u001b[?25h\u001b[2J\u001b[H");

  await runClean({
    outputDir,
    move: choice === "move",
    dryRun: choice === "dry",
    promptFn,
  });

  if (process.stdin.isTTY) {
    process.stdout.write("\nPress any key to return to menu...\n");
    await readKey();
  }
}
