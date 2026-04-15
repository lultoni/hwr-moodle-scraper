/**
 * TUI Reset-Screen.
 * Shows options and always confirms with the equivalent CLI command before running.
 */

import { runReset } from "../../commands/reset.js";
import { selectItem } from "../select.js";
import { showConfirm } from "./scrape-screen.js";
import { readKey } from "../keys.js";
import type { PromptFn } from "../../auth/prompt.js";

const APP_TITLE = "HWR Moodle Scraper";

interface ResetChoice {
  value: string;
  label: string;
  cliFlags: string;
  opts: { full?: boolean; dryRun?: boolean; moveUserFiles?: boolean };
}

const CHOICES: ResetChoice[] = [
  {
    value: "partial",
    label: "Partial — delete scraped files + state",
    cliFlags: "msc reset",
    opts: {},
  },
  {
    value: "partial-move",
    label: "Partial + move user files first",
    cliFlags: "msc reset --move-user-files",
    opts: { moveUserFiles: true },
  },
  {
    value: "full",
    label: "Full — also clear config and credentials",
    cliFlags: "msc reset --full",
    opts: { full: true },
  },
  {
    value: "full-move",
    label: "Full + move user files first",
    cliFlags: "msc reset --full --move-user-files",
    opts: { full: true, moveUserFiles: true },
  },
  {
    value: "dry",
    label: "Dry-run — preview what would be deleted",
    cliFlags: "msc reset --dry-run",
    opts: { dryRun: true },
  },
];

export async function resetScreen(outputDir: string, promptFn: PromptFn, version: string): Promise<void> {
  const choice = await selectItem({
    appTitle: APP_TITLE, version,
    screenTitle: "── Reset ──",
    items: [
      ...CHOICES.map((c) => ({ label: c.label, value: c.value })),
      { label: "Back to menu", value: "back" },
    ],
    promptFn,
  });

  if (choice === "back") return;

  const selected = CHOICES.find((c) => c.value === choice);
  if (!selected) return;

  const confirmed = await showConfirm(version, "── Reset — Confirm ──", selected.cliFlags, promptFn);
  if (!confirmed) return;

  process.stdout.write("\u001b[?25h\u001b[2J\u001b[H");

  await runReset({
    outputDir,
    promptFn,
    ...selected.opts,
  });

  if (process.stdin.isTTY) {
    process.stdout.write("\nPress any key to return to menu...\n");
    await readKey();
  }
}
