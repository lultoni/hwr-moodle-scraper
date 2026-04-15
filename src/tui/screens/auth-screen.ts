/**
 * TUI Auth-Screen.
 * Shows auth status and allows set/clear operations.
 * Clear always confirms before acting.
 */

import { tryCreateKeychain } from "../../auth/keychain.js";
import { runAuthSet, runAuthClear, runAuthStatus } from "../../commands/auth.js";
import { createHttpClient } from "../../http/client.js";
import { selectItem } from "../select.js";
import { showConfirm } from "./scrape-screen.js";
import { readKey } from "../keys.js";
import type { PromptFn } from "../../auth/prompt.js";

const APP_TITLE = "HWR Moodle Scraper";

export async function authScreen(promptFn: PromptFn, version: string): Promise<void> {
  const keychain = tryCreateKeychain();
  const httpClient = createHttpClient();

  // Show auth status before the selection list (clear screen, plain output)
  process.stdout.write("\u001b[?25h\u001b[2J\u001b[H");
  await runAuthStatus({ keychain, httpClient });
  process.stdout.write("\n");

  const choice = await selectItem({
    appTitle: APP_TITLE, version,
    screenTitle: "── Auth ──",
    items: [
      { label: "Set / update credentials",       value: "set" },
      { label: "Clear credentials and session",  value: "clear" },
      { label: "Back to menu",                   value: "back" },
    ],
    promptFn,
  });

  if (choice === "back") return;

  if (choice === "clear") {
    const confirmed = await showConfirm(version, "── Auth — Confirm ──", "msc auth clear", promptFn);
    if (!confirmed) return;
  }

  process.stdout.write("\u001b[?25h\u001b[2J\u001b[H");

  if (choice === "set") {
    await runAuthSet({ keychain, promptFn, httpClient });
  } else if (choice === "clear") {
    await runAuthClear({ keychain, promptFn });
  }

  if (process.stdin.isTTY) {
    process.stdout.write("\nPress any key to return to menu...\n");
    await readKey();
  }
}
