/**
 * TUI Status-Screen.
 * Lets the user choose between summary view and detailed issues view.
 * No confirmation needed (read-only operation).
 */

import { runStatus } from "../../commands/status.js";
import { selectItem } from "../select.js";
import { readKey } from "../keys.js";
import type { PromptFn } from "../../auth/prompt.js";

const APP_TITLE = "HWR Moodle Scraper";

export async function statusScreen(outputDir: string, promptFn: PromptFn, version: string): Promise<void> {
  const choice = await selectItem({
    appTitle: APP_TITLE, version,
    screenTitle: "── Status ──",
    items: [
      { label: "Summary — last sync overview",                    value: "summary" },
      { label: "Issues — missing / orphaned / user-added files",  value: "issues" },
      { label: "Back to menu",                                    value: "back" },
    ],
    promptFn,
  });

  if (choice === "back") return;

  // Show cursor + clear screen before running (status prints plain text output)
  process.stdout.write("\u001b[?25h\u001b[2J\u001b[H");
  await runStatus({ outputDir, showIssues: choice === "issues" });

  if (process.stdin.isTTY) {
    process.stdout.write("\nPress any key to return to menu...\n");
    await readKey();
  }
}
