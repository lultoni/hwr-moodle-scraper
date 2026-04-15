/**
 * TUI Config-Screen.
 * Shows all user-editable config keys grouped by category.
 * Derives keys from USER_EDITABLE_KEYS (single source of truth in config.ts).
 */

import { ConfigManager, USER_EDITABLE_KEYS, type ConfigKey, type ConfigValue } from "../../config.js";
import { readKey } from "../keys.js";
import { render, paginate, type RenderItem } from "../renderer.js";
import type { PromptFn } from "../../auth/prompt.js";

const APP_TITLE = "HWR Moodle Scraper";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

/** Category labels for config keys */
const CATEGORIES: Record<ConfigKey, string> = {
  outputDir:              "Filesystem",
  courseSearch:           "Filesystem",
  minFreeDiskMb:          "Filesystem",
  logFile:                "Filesystem",
  maxConcurrentDownloads: "Network",
  requestDelayMs:         "Network",
  requestJitterMs:        "Network",
  retryBaseDelayMs:       "Network",
  checkUpdates:           "Notifications",
  logHintShown:           "Internal",
};

const NUMERIC_KEYS: ConfigKey[] = [
  "minFreeDiskMb", "maxConcurrentDownloads", "requestDelayMs", "requestJitterMs", "retryBaseDelayMs",
];

const BOOL_KEYS: ConfigKey[] = ["checkUpdates"];

function formatValue(v: ConfigValue): string {
  if (v === null || v === undefined) return "(not set)";
  if (v === "") return "(empty)";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export async function configScreen(promptFn: PromptFn, version: string): Promise<void> {
  const mgr = new ConfigManager();
  let focusedIdx = 0;
  let page = 1;

  while (true) {
    const all = await mgr.list();

    // Build grouped list
    const grouped: Map<string, ConfigKey[]> = new Map();
    for (const key of USER_EDITABLE_KEYS) {
      const cat = CATEGORIES[key] ?? "Other";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(key);
    }

    // Flatten into render items, tracking focusable indices
    const renderItems: RenderItem[] = [];
    const focusableKeys: ConfigKey[] = []; // parallel array: focusableKeys[i] = key for focusedIdx i

    for (const [cat, keys] of grouped) {
      renderItems.push({ type: "text", content: `── ${cat} ────────────────────────` });
      for (const key of keys) {
        const val = formatValue(all[key] ?? null);
        renderItems.push({
          type: "selector",
          label: `${key.padEnd(26)} ${val}`,
          focused: focusedIdx === focusableKeys.length,
        });
        focusableKeys.push(key);
      }
      renderItems.push({ type: "blank" });
    }

    // Add "Back" entry
    renderItems.push({
      type: "selector",
      label: "← Back to menu",
      focused: focusedIdx === focusableKeys.length,
    });
    const backIdx = focusableKeys.length; // index of "Back" in focusable items

    process.stdout.write(HIDE_CURSOR);

    function draw(): void {
      const rows = process.stdout.rows ?? 24;
      const { pageItems, totalPages } = paginate(renderItems, page, rows);
      render({
        appTitle: APP_TITLE, version,
        title: "── Config ──",
        items: pageItems, page, totalPages,
        footer: "↑↓ navigate  Enter edit  q back",
      });
    }

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 50); };
    process.stdout.on("resize", onResize);

    draw();

    let action: "edit" | "back" | null = null;

    while (action === null) {
      const key = await readKey();
      if (key.name === "up") {
        focusedIdx = (focusedIdx - 1 + focusableKeys.length + 1) % (focusableKeys.length + 1);
      } else if (key.name === "down") {
        focusedIdx = (focusedIdx + 1) % (focusableKeys.length + 1);
      } else if (key.name === "pageup") {
        focusedIdx = Math.max(0, focusedIdx - Math.max(1, (process.stdout.rows ?? 24) - 9));
      } else if (key.name === "pagedown") {
        focusedIdx = Math.min(focusableKeys.length, focusedIdx + Math.max(1, (process.stdout.rows ?? 24) - 9));
      } else if (key.name === "enter") {
        action = focusedIdx === backIdx ? "back" : "edit";
      } else if (key.name === "escape" || (key.name === "char" && key.char === "q")) {
        action = "back";
      }

      // Update page to keep focused item visible
      const rows = process.stdout.rows ?? 24;
      const pageSize = Math.max(1, rows - 9);
      // Count which visible item index corresponds to focusedIdx
      let visIdx = 0;
      for (const item of renderItems) {
        if (item.type === "selector" || item.type === "toggle" || item.type === "radio") {
          if (item.focused) { page = Math.floor(visIdx / pageSize) + 1; break; }
          visIdx++;
        }
      }

      if (action === null) draw();
    }

    clearTimeout(resizeTimer);
    process.stdout.removeListener("resize", onResize);
    process.stdout.write(SHOW_CURSOR);

    if (action === "back") return;

    // Edit the focused key
    const selectedKey = focusableKeys[focusedIdx];
    if (!selectedKey) return;

    const current = formatValue(all[selectedKey] ?? null);
    process.stdout.write(`\u001b[2J\u001b[H`);
    process.stdout.write(`Editing: ${selectedKey}\nCurrent: ${current}\n\n`);

    if (BOOL_KEYS.includes(selectedKey)) {
      process.stdout.write(`New value (true/false, Enter to keep): `);
    } else {
      process.stdout.write(`New value (Enter to keep current): `);
    }

    const newVal = await promptFn("");
    if (newVal.trim() !== "") {
      let coerced: ConfigValue;
      if (BOOL_KEYS.includes(selectedKey)) {
        coerced = newVal.trim() === "true" ? true : newVal.trim() === "false" ? false : null;
        if (coerced === null) {
          process.stdout.write(`Invalid value — must be "true" or "false".\n`);
          if (process.stdin.isTTY) { process.stdout.write("\nPress any key...\n"); await readKey(); }
          continue;
        }
      } else if (NUMERIC_KEYS.includes(selectedKey)) {
        coerced = Number(newVal.trim());
      } else {
        coerced = newVal.trim() === "null" ? null : newVal.trim();
      }
      try {
        await mgr.set(selectedKey, coerced);
        process.stdout.write(`✓ Set ${selectedKey} = ${String(coerced)}\n`);
      } catch (err) {
        process.stdout.write(`Error: ${(err as Error).message}\n`);
      }
    } else {
      process.stdout.write("(unchanged)\n");
    }

    if (process.stdin.isTTY) {
      process.stdout.write("\nPress any key to continue...\n");
      await readKey();
    }
  }
}
