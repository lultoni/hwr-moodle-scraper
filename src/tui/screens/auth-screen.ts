/**
 * TUI Auth-Screen.
 * Shows auth status and allows set/clear operations.
 */

import { KeychainAdapter } from "../../auth/keychain.js";
import { runAuthSet, runAuthClear, runAuthStatus } from "../../commands/auth.js";
import { createHttpClient } from "../../http/client.js";
import { selectItem } from "../select.js";
import { readKey } from "../keys.js";
import type { PromptFn } from "../../auth/prompt.js";

export async function authScreen(promptFn: PromptFn): Promise<void> {
  process.stdout.write("\u001b[2J\u001b[H");
  process.stdout.write("─── Auth ───\n\n");

  const keychain = new KeychainAdapter();
  const httpClient = createHttpClient();
  await runAuthStatus({ keychain, httpClient });

  process.stdout.write("\n");

  const choice = await selectItem({
    title: "Choose action:",
    items: [
      { label: "Set / update credentials", value: "set" },
      { label: "Clear credentials and session", value: "clear" },
      { label: "Back to menu", value: "back" },
    ],
    promptFn,
  });

  if (choice === "set") {
    await runAuthSet({ keychain, promptFn, httpClient });
  } else if (choice === "clear") {
    await runAuthClear({ keychain, promptFn });
  }

  if (process.stdin.isTTY && choice !== "back") {
    process.stdout.write("\nPress any key to return to menu...\n");
    await readKey();
  }
}
