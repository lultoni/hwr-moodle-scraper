/**
 * TUI Help screen.
 * Shows a topic picker backed by selectItem(); displays the chosen help text
 * then loops back to the picker until the user selects "← Back" or presses q.
 */

import { runHelp, HELP_TOPICS } from "../../commands/help.js";
import { selectItem } from "../select.js";
import { readKey } from "../keys.js";
import { C, HIDE_CURSOR, SHOW_CURSOR, CLEAR, APP_TITLE } from "../renderer.js";
import type { PromptFn } from "../../auth/prompt.js";

export async function helpScreen(_outputDir: string, promptFn: PromptFn, version: string): Promise<void> {
  const topicItems = [
    ...HELP_TOPICS.map((t) => ({ label: t, value: t })),
    { label: "← Back", value: "back" },
  ];

  while (true) {
    const chosen = await selectItem({
      appTitle: APP_TITLE,
      version,
      screenTitle: "── Help ──",
      items: topicItems,
      footer: "↑↓ navigate  Enter select  q back",
      promptFn,
    });

    if (chosen === "back") return;

    if (!process.stdin.isTTY) {
      runHelp(chosen);
      return;
    }

    process.stdout.write(HIDE_CURSOR);
    process.stdout.write(CLEAR);
    runHelp(chosen);
    process.stdout.write(`${C.dimItal}\nPress any key to return to topics...${C.reset}\n`);
    process.stdout.write(SHOW_CURSOR);
    await readKey();
  }
}
