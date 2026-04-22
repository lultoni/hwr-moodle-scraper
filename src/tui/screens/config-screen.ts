/**
 * TUI Config-Screen.
 * Shows all user-editable config keys grouped by category.
 * Derives keys from USER_EDITABLE_KEYS (single source of truth in config.ts).
 */

import { ConfigManager, USER_EDITABLE_KEYS, CONFIG_DESCRIPTIONS, type ConfigKey, type ConfigValue } from "../../config.js";
import { readKey } from "../keys.js";
import { render, paginate, HIDE_CURSOR, SHOW_CURSOR, CLEAR, APP_TITLE, type RenderItem } from "../renderer.js";
import type { PromptFn } from "../../auth/prompt.js";

/** Category labels for config keys */
const CATEGORIES: Record<ConfigKey, string> = {
  outputDir:                    "Filesystem",
  courseSearch:                 "Filesystem",
  excludePaths:                 "Filesystem",
  minFreeDiskMb:                "Filesystem",
  logFile:                      "Filesystem",
  displayPathFormat:            "Filesystem",
  postScrapeHook:               "Automation",
  maxConcurrentDownloads:       "Network",
  requestDelayMs:               "Network",
  requestJitterMs:              "Network",
  retryBaseDelayMs:             "Network",
  checkUpdates:                 "Notifications",
  updateCheckIntervalHours:     "Notifications",
  logHintShown:                 "Internal",
  lastUpdateCheckMs:            "Internal",
};

const NUMERIC_KEYS: ConfigKey[] = [
  "minFreeDiskMb", "maxConcurrentDownloads", "requestDelayMs", "requestJitterMs", "retryBaseDelayMs",
  "updateCheckIntervalHours",
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

    // Build grouped list (stable across the outer loop)
    const grouped: Map<string, ConfigKey[]> = new Map();
    for (const key of USER_EDITABLE_KEYS) {
      const cat = CATEGORIES[key] ?? "Other";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(key);
    }

    /** Build render items fresh from current focusedIdx — fixes stale-cursor bug. */
    function buildItems(fIdx: number): { renderItems: RenderItem[]; focusableKeys: ConfigKey[] } {
      const renderItems: RenderItem[] = [];
      const focusableKeys: ConfigKey[] = [];
      for (const [cat, keys] of grouped) {
        renderItems.push({ type: "text", content: `── ${cat} ────────────────────────` });
        for (const key of keys) {
          const val = formatValue(all[key] ?? null);
          const desc = CONFIG_DESCRIPTIONS[key];
          renderItems.push({
            type: "selector",
            label: `${key.padEnd(26)} ${val}`,
            focused: fIdx === focusableKeys.length,
          });
          if (desc) {
            renderItems.push({ type: "text", content: `   ${desc}` });
          }
          focusableKeys.push(key);
        }
        renderItems.push({ type: "blank" });
      }
      // "Back" entry
      renderItems.push({
        type: "selector",
        label: "← Back to menu",
        focused: fIdx === focusableKeys.length,
      });
      return { renderItems, focusableKeys };
    }

    // Derive total focusable count from a one-off build
    const { focusableKeys: allKeys } = buildItems(0);
    const totalFocusable = allKeys.length + 1; // +1 for Back

    process.stdout.write(HIDE_CURSOR);

    function draw(): void {
      const { renderItems } = buildItems(focusedIdx);
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
        focusedIdx = (focusedIdx - 1 + totalFocusable) % totalFocusable;
      } else if (key.name === "down") {
        focusedIdx = (focusedIdx + 1) % totalFocusable;
      } else if (key.name === "pageup") {
        focusedIdx = Math.max(0, focusedIdx - Math.max(1, (process.stdout.rows ?? 24) - 9));
      } else if (key.name === "pagedown") {
        focusedIdx = Math.min(totalFocusable - 1, focusedIdx + Math.max(1, (process.stdout.rows ?? 24) - 9));
      } else if (key.name === "enter") {
        action = focusedIdx === totalFocusable - 1 ? "back" : "edit";
      } else if (key.name === "escape" || (key.name === "char" && key.char === "q")) {
        action = "back";
      }

      // Update page to keep focused item visible — use fresh items with updated focusedIdx
      const rows = process.stdout.rows ?? 24;
      const pageSize = Math.max(1, rows - 9);
      const { renderItems: freshItems } = buildItems(focusedIdx);
      let visIdx = 0;
      for (const item of freshItems) {
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
    const { focusableKeys } = buildItems(focusedIdx);
    const selectedKey = focusableKeys[focusedIdx];
    if (!selectedKey) return;

    const current = formatValue(all[selectedKey] ?? null);
    process.stdout.write(CLEAR);
    const desc = CONFIG_DESCRIPTIONS[selectedKey];
    if (desc) process.stdout.write(`  ${desc}\n\n`);
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
