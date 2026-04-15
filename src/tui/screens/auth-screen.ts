/**
 * TUI Auth-Screen.
 * Shows a sub-menu for auth operations. The "Show credentials" option
 * displays stored credentials inline with a countdown before returning.
 */

import { tryCreateKeychain } from "../../auth/keychain.js";
import { runAuthSet, runAuthClear, runAuthStatus } from "../../commands/auth.js";
import { createHttpClient } from "../../http/client.js";
import { selectItem } from "../select.js";
import { showConfirm } from "./scrape-screen.js";
import { readKey } from "../keys.js";
import { C } from "../renderer.js";
import type { PromptFn } from "../../auth/prompt.js";

const APP_TITLE = "HWR Moodle Scraper";

export async function authScreen(promptFn: PromptFn, version: string): Promise<void> {
  const keychain = tryCreateKeychain();
  const httpClient = createHttpClient();

  // Fetch stored username for display in menu item label
  let storedUsername: string | null = null;
  if (keychain) {
    const creds = await keychain.readCredentials().catch(() => null);
    storedUsername = creds?.username ?? null;
  }
  if (!storedUsername) storedUsername = process.env["MSC_USERNAME"] ?? null;

  const showLabel = storedUsername ? `Show credentials (${storedUsername})` : "Show credentials";

  while (true) {
    const choice = await selectItem({
      appTitle: APP_TITLE, version,
      screenTitle: "── Auth ──",
      items: [
        { label: "Set / update credentials",      value: "set" as const },
        { label: showLabel,                        value: "show" as const },
        { label: "Clear credentials and session",  value: "clear" as const },
        { label: "← Back to menu",                value: "back" as const },
      ],
      promptFn,
    });

    if (choice === "back") return;

    if (choice === "show") {
      process.stdout.write("\u001b[?25h\u001b[2J\u001b[H");
      await runAuthStatus({ keychain, httpClient });
      process.stdout.write("\n");
      // 3-dot countdown animation: "..." → ".." → "." then return to auth menu
      for (const dots of ["...", "..", "."]) {
        process.stdout.write(`\rReturning to menu ${dots}  `);
        await new Promise<void>((r) => setTimeout(r, 1000));
      }
      process.stdout.write("\r" + " ".repeat(30) + "\r");
      continue;
    }

    if (choice === "clear") {
      const confirmed = await showConfirm(version, "── Auth — Confirm ──", "msc auth clear", promptFn);
      if (!confirmed) continue;
    }

    process.stdout.write("\u001b[?25h\u001b[2J\u001b[H");

    if (choice === "set") {
      await runAuthSet({ keychain, promptFn, httpClient });
    } else if (choice === "clear") {
      await runAuthClear({ keychain, promptFn });
    }

    if (process.stdin.isTTY) {
      process.stdout.write(`${C.dimItal}\nPress any key to return to menu...${C.reset}\n`);
      await readKey();
    }
    return;
  }
}
