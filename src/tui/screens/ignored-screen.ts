/**
 * TUI Ignored-Screen.
 * Runs `msc ignored` and shows results. Simple informational screen — no options.
 */

import { runIgnored } from "../../commands/ignored.js";
import { readKey } from "../keys.js";
import { C, HIDE_CURSOR, SHOW_CURSOR, CLEAR } from "../renderer.js";
import type { PromptFn } from "../../auth/prompt.js";

export async function ignoredScreen(outputDir: string, _promptFn: PromptFn, _version: string): Promise<void> {
  if (!process.stdin.isTTY) {
    await runIgnored({ outputDir });
    return;
  }

  process.stdout.write(HIDE_CURSOR);
  process.stdout.write(CLEAR);
  await runIgnored({ outputDir });
  process.stdout.write(`${C.dimItal}\nPress any key to return to menu...${C.reset}\n`);
  process.stdout.write(SHOW_CURSOR);
  await readKey();
}
