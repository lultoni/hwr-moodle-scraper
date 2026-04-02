/**
 * TUI Reset-Screen.
 * Shows options and runs the reset flow (optionally with --move-user-files).
 */

import { runReset } from "../../commands/reset.js";
import { selectItem } from "../select.js";
import { readKey } from "../keys.js";
import type { PromptFn } from "../../auth/prompt.js";

export async function resetScreen(outputDir: string, promptFn: PromptFn): Promise<void> {
  process.stdout.write("\u001b[2J\u001b[H");
  process.stdout.write("─── Reset ───\n\n");
  process.stdout.write(`Output directory: ${outputDir}\n\n`);

  const choice = await selectItem({
    title: "Choose reset scope:",
    items: [
      { label: "Partial — delete scraped files + state (keep config/credentials)", value: "partial" },
      { label: "Partial + move user files first", value: "partial-move" },
      { label: "Full — also clear config and credentials", value: "full" },
      { label: "Full + move user files first", value: "full-move" },
      { label: "Dry-run — preview what would be deleted", value: "dry" },
      { label: "Back to menu", value: "back" },
    ],
    promptFn,
  });

  if (choice === "back") return;

  process.stdout.write("\u001b[2J\u001b[H");

  if (choice === "dry") {
    await runReset({ outputDir, dryRun: true });
  } else if (choice === "partial") {
    await runReset({ outputDir, promptFn });
  } else if (choice === "partial-move") {
    await runReset({ outputDir, promptFn, moveUserFiles: true });
  } else if (choice === "full") {
    await runReset({ outputDir, full: true, promptFn });
  } else if (choice === "full-move") {
    await runReset({ outputDir, full: true, promptFn, moveUserFiles: true });
  }

  if (process.stdin.isTTY) {
    process.stdout.write("\nPress any key to return to menu...\n");
    await readKey();
  }
}
