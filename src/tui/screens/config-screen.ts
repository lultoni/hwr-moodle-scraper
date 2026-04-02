/**
 * TUI Config-Screen.
 * Shows all config keys interactively and allows editing them.
 */

import { ConfigManager, type ConfigKey, type ConfigValue } from "../../config.js";
import { selectItem } from "../select.js";
import { readKey } from "../keys.js";
import type { PromptFn } from "../../auth/prompt.js";

/** Config keys that should be shown as user-editable (excluding internal flags). */
const EDITABLE_KEYS: ConfigKey[] = [
  "outputDir",
  "courseSearch",
  "minFreeDiskMb",
  "maxConcurrentDownloads",
  "requestDelayMs",
  "requestJitterMs",
  "retryBaseDelayMs",
  "logFile",
];

function formatValue(v: ConfigValue): string {
  if (v === null || v === undefined) return "(not set)";
  if (v === "") return "(empty)";
  return String(v);
}

export async function configScreen(promptFn: PromptFn): Promise<void> {
  const mgr = new ConfigManager();

  while (true) {
    process.stdout.write("\u001b[2J\u001b[H");
    process.stdout.write("─── Config Editor ───\n\n");

    const all = await mgr.list();
    const items = EDITABLE_KEYS.map((key, i) => ({
      label: `${(i + 1).toString().padStart(2)}. ${key.padEnd(26)} ${formatValue(all[key] ?? null)}`,
      value: key,
    }));
    items.push({ label: " q. Back to menu", value: "back" as ConfigKey });

    const chosen = await selectItem({ title: "Select key to edit:", items, promptFn });

    if ((chosen as string) === "back") return;

    const key = chosen as ConfigKey;
    const current = formatValue(all[key] ?? null);
    process.stdout.write(`\nEditing: ${key}\nCurrent: ${current}\n`);

    const newVal = await promptFn(`New value (Enter to keep current): `);
    if (newVal.trim() !== "") {
      const numericKeys: ConfigKey[] = ["minFreeDiskMb", "maxConcurrentDownloads", "requestDelayMs", "requestJitterMs", "retryBaseDelayMs"];
      const coerced: ConfigValue = numericKeys.includes(key) ? Number(newVal.trim()) : (newVal.trim() === "null" ? null : newVal.trim());
      await mgr.set(key, coerced);
      process.stdout.write(`✓ Set ${key} = ${String(coerced)}\n`);
    } else {
      process.stdout.write("(unchanged)\n");
    }

    if (process.stdin.isTTY) {
      process.stdout.write("\nPress any key to continue...\n");
      await readKey();
    }
  }
}
