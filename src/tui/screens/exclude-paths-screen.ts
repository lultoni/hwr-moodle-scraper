/**
 * TUI list editor for the excludePaths config key.
 * Shows built-in default patterns (marked *, non-removable) and user-added patterns.
 * [a] Add, [d] Delete selected user pattern, [Enter/q] Save and return.
 */

import { ConfigManager } from "../../config.js";
import { DEFAULT_EXCLUDE_PATTERNS } from "../../fs/collect.js";
import { readKey } from "../keys.js";
import { render, HIDE_CURSOR, SHOW_CURSOR, CLEAR, APP_TITLE, type RenderItem } from "../renderer.js";
import type { PromptFn } from "../../auth/prompt.js";

export async function excludePathsScreen(promptFn: PromptFn, version: string): Promise<void> {
  const mgr = new ConfigManager();

  // Load current user patterns from config (excludePaths is comma-separated)
  const raw = (await mgr.get("excludePaths")) as string;
  // User patterns: everything NOT already in the built-in defaults list
  let userPatterns: string[] = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !DEFAULT_EXCLUDE_PATTERNS.includes(s));

  // focusIdx iterates only over user patterns (built-ins are non-interactive)
  let focusIdx = 0;
  let message = "";

  process.stdout.write(HIDE_CURSOR);

  function buildItems(): RenderItem[] {
    const items: RenderItem[] = [];
    items.push({ type: "text", content: "  Patterns excluded from user-files detection." });
    items.push({ type: "blank" });
    items.push({ type: "text", content: "  Built-in (always active, cannot be removed):" });
    for (const p of DEFAULT_EXCLUDE_PATTERNS) {
      items.push({ type: "text", content: `    * ${p}` });
    }
    items.push({ type: "blank" });
    if (userPatterns.length === 0) {
      items.push({ type: "text", content: "  No custom patterns. Press [a] to add one." });
    } else {
      items.push({ type: "text", content: "  Custom patterns:" });
      for (let i = 0; i < userPatterns.length; i++) {
        items.push({
          type: "selector",
          label: `    ${userPatterns[i]}`,
          focused: i === focusIdx,
        });
      }
    }
    items.push({ type: "blank" });
    if (message) {
      items.push({ type: "text", content: `  ${message}` });
      items.push({ type: "blank" });
    }
    return items;
  }

  function draw(): void {
    render({
      appTitle: APP_TITLE,
      version,
      title: "── Exclude Paths ──",
      items: buildItems(),
      footer: "[a] Add  [d] Delete selected  [↑↓] Navigate  [q/Enter] Done",
    });
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 50); };
  process.stdout.on("resize", onResize);

  draw();

  loop: while (true) {
    const key = await readKey();

    message = ""; // clear status on each keypress

    if (key.name === "up") {
      if (userPatterns.length > 0) {
        focusIdx = (focusIdx - 1 + userPatterns.length) % userPatterns.length;
      }
    } else if (key.name === "down") {
      if (userPatterns.length > 0) {
        focusIdx = (focusIdx + 1) % userPatterns.length;
      }
    } else if (key.name === "escape" || key.name === "enter" || (key.name === "char" && key.char === "q")) {
      break loop;
    } else if (key.name === "char" && key.char === "d") {
      if (userPatterns.length === 0) {
        message = "No custom patterns to delete.";
      } else {
        const removed = userPatterns[focusIdx];
        userPatterns = userPatterns.filter((_, i) => i !== focusIdx);
        if (focusIdx >= userPatterns.length) focusIdx = Math.max(0, userPatterns.length - 1);
        message = `Removed: ${removed}`;
        // Save immediately
        await mgr.set("excludePaths", userPatterns.join(","));
      }
    } else if (key.name === "char" && key.char === "a") {
      // Add a new pattern via promptFn
      process.stdout.write(SHOW_CURSOR);
      clearTimeout(resizeTimer);
      process.stdout.removeListener("resize", onResize);

      process.stdout.write(CLEAR);
      process.stdout.write("  Add an exclude pattern (e.g. my-notes/**, .private/**)\n");
      process.stdout.write("  Leave blank to cancel.\n\n");
      process.stdout.write("  Pattern: ");
      const input = (await promptFn("")).trim();

      if (input.length > 0) {
        if (DEFAULT_EXCLUDE_PATTERNS.includes(input)) {
          message = `"${input}" is already a built-in default — no need to add it.`;
        } else if (userPatterns.includes(input)) {
          message = `"${input}" is already in the list.`;
        } else {
          userPatterns.push(input);
          focusIdx = userPatterns.length - 1;
          message = `Added: ${input}`;
          await mgr.set("excludePaths", userPatterns.join(","));
        }
      }

      process.stdout.write(HIDE_CURSOR);
      process.stdout.on("resize", onResize);
      resizeTimer = undefined;
    }

    draw();
  }

  clearTimeout(resizeTimer);
  process.stdout.removeListener("resize", onResize);
  process.stdout.write(SHOW_CURSOR);
}
