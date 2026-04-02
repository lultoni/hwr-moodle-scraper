/**
 * TUI Status-Screen.
 * Lets the user choose between summary view and detailed issues view.
 */

import { runStatus } from "../../commands/status.js";
import { selectItem } from "../select.js";
import { readKey } from "../keys.js";
import type { PromptFn } from "../../auth/prompt.js";

const CLEAR = "\u001b[2J\u001b[H";

export async function statusScreen(outputDir: string, promptFn: PromptFn): Promise<void> {
  process.stdout.write(CLEAR);
  process.stdout.write("─── Status ───\n\n");

  const choice = await selectItem({
    title: "Choose view:",
    items: [
      { label: "Summary — last sync overview", value: "summary" },
      { label: "Issues — missing / orphaned / user files", value: "issues" },
      { label: "Back to menu", value: "back" },
    ],
    promptFn,
  });

  if (choice === "back") return;

  process.stdout.write(CLEAR);
  await runStatus({ outputDir, showIssues: choice === "issues" });

  if (process.stdin.isTTY) {
    process.stdout.write("\nPress any key to return to menu...\n");
    await readKey();
  }
}
