/**
 * TUI Reset-Screen.
 * Checkboxes for what to reset + toggles for options + Run button.
 * Always confirms with the equivalent CLI command before acting.
 */

import { runReset } from "../../commands/reset.js";
import { readKey } from "../keys.js";
import { render, paginate, C, HIDE_CURSOR, SHOW_CURSOR, CLEAR, APP_TITLE, type RenderItem } from "../renderer.js";
import { showConfirm } from "./scrape-screen.js";
import type { PromptFn } from "../../auth/prompt.js";

interface ResetToggle { key: string; label: string; flag: string }

const WHAT_TOGGLES: ResetToggle[] = [
  { key: "state",       label: "State only            (--state)",       flag: "--state" },
  { key: "files",       label: "State + tracked files (--files)",       flag: "--files" },
  { key: "config",      label: "Config                (--config)",      flag: "--config" },
  { key: "credentials", label: "Credentials           (--credentials)", flag: "--credentials" },
];

const OPT_TOGGLES: ResetToggle[] = [
  { key: "moveUserFiles", label: "Move user files first  (--move-user-files)", flag: "--move-user-files" },
  { key: "dryRun",        label: "Dry-run — preview only  (--dry-run)",         flag: "--dry-run" },
];

const ALL_TOGGLES = [...WHAT_TOGGLES, ...OPT_TOGGLES];
const TOGGLE_COUNT = ALL_TOGGLES.length;
const RUN_IDX  = TOGGLE_COUNT;
const BACK_IDX = TOGGLE_COUNT + 1;
const TOTAL    = TOGGLE_COUNT + 2;

function buildCliCommand(boolState: Record<string, boolean>): string {
  const parts = ["msc reset"];
  for (const t of ALL_TOGGLES) { if (boolState[t.key]) parts.push(t.flag); }
  return parts.join(" ");
}

export async function resetScreen(outputDir: string, promptFn: PromptFn, version: string): Promise<void> {
  if (!process.stdin.isTTY) {
    const answer = await promptFn("Run msc reset? [y/N] ");
    if (answer.trim().toLowerCase() !== "y") return;
    await runReset({ outputDir, promptFn });
    return;
  }

  const boolState: Record<string, boolean> = {};
  for (const t of ALL_TOGGLES) boolState[t.key] = false;
  let focused = 0;
  let page = 1;

  function buildItems(): RenderItem[] {
    const items: RenderItem[] = [];
    items.push({ type: "text", content: "── What to reset ──────────────────" });
    for (let i = 0; i < WHAT_TOGGLES.length; i++) {
      const t = WHAT_TOGGLES[i]!;
      items.push({ type: "toggle", label: t.label, checked: boolState[t.key]!, focused: focused === i });
    }
    items.push({ type: "blank" });
    items.push({ type: "text", content: "── Options ───────────────────────" });
    for (let i = 0; i < OPT_TOGGLES.length; i++) {
      const t = OPT_TOGGLES[i]!;
      items.push({ type: "toggle", label: t.label, checked: boolState[t.key]!, focused: focused === WHAT_TOGGLES.length + i });
    }
    items.push({ type: "blank" });
    items.push({ type: "selector", label: "→  Run Reset", focused: focused === RUN_IDX });
    items.push({ type: "blank" });
    items.push({ type: "selector", label: "← Back to menu", focused: focused === BACK_IDX });
    return items;
  }

  process.stdout.write(HIDE_CURSOR);

  function draw(): void {
    const rows = process.stdout.rows ?? 24;
    const allItems = buildItems();
    const { pageItems, totalPages } = paginate(allItems, page, rows);
    render({
      appTitle: APP_TITLE, version, title: "── Reset ──",
      items: pageItems, page, totalPages,
      footer: "↑↓ navigate  Space toggle  Enter select/run  q back",
    });
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 50); };
  process.stdout.on("resize", onResize);

  draw();

  try {
    while (true) {
      const key = await readKey();

      if (key.name === "up") {
        focused = (focused - 1 + TOTAL) % TOTAL;
      } else if (key.name === "down") {
        focused = (focused + 1) % TOTAL;
      } else if (key.name === "pageup") {
        focused = Math.max(0, focused - Math.max(1, (process.stdout.rows ?? 24) - 9));
      } else if (key.name === "pagedown") {
        focused = Math.min(TOTAL - 1, focused + Math.max(1, (process.stdout.rows ?? 24) - 9));
      } else if (key.name === "escape" || (key.name === "char" && key.char === "q")) {
        return;
      } else if (key.name === "enter" || (key.name === "char" && key.char === " ")) {
        if (focused < TOGGLE_COUNT) {
          const t = ALL_TOGGLES[focused]!;
          boolState[t.key] = !boolState[t.key];
        } else if (focused === RUN_IDX) {
          const cliCmd = buildCliCommand(boolState);
          const confirmed = await showConfirm(version, "── Reset — Confirm ──", cliCmd, promptFn);
          if (!confirmed) { draw(); continue; }

          clearTimeout(resizeTimer);
          process.stdout.removeListener("resize", onResize);
          process.stdout.write(SHOW_CURSOR);
          process.stdout.write(CLEAR);

          await runReset({
            outputDir,
            promptFn,
            state:       boolState["state"] === true,
            files:       boolState["files"] === true,
            config:      boolState["config"] === true,
            credentials: boolState["credentials"] === true,
            moveUserFiles: boolState["moveUserFiles"] === true,
            dryRun: boolState["dryRun"] === true,
          });

          if (process.stdin.isTTY) {
            process.stdout.write(`${C.dimItal}\nPress any key to return to menu...${C.reset}\n`);
            await readKey();
          }
          return;
        } else if (focused === BACK_IDX) {
          return;
        }
      }

      // Update page to keep focused item visible
      const rows = process.stdout.rows ?? 24;
      const pageSize = Math.max(1, rows - 9);
      const allItems = buildItems();
      let visIdx = 0;
      for (const item of allItems) {
        if (item.type === "toggle" || item.type === "selector") {
          if (item.focused) { page = Math.floor(visIdx / pageSize) + 1; break; }
          visIdx++;
        }
      }

      draw();
    }
  } finally {
    clearTimeout(resizeTimer);
    process.stdout.removeListener("resize", onResize);
    process.stdout.write(SHOW_CURSOR);
  }
}
