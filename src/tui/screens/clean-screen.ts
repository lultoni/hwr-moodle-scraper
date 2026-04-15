/**
 * TUI Clean-Screen.
 * Radio for mode (delete/move) + dry-run toggle + Run button.
 * Always confirms with the equivalent CLI command before acting.
 */

import { runClean } from "../../commands/clean.js";
import { readKey } from "../keys.js";
import { render, paginate, C, type RenderItem } from "../renderer.js";
import { showConfirm } from "./scrape-screen.js";
import type { PromptFn } from "../../auth/prompt.js";

const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const APP_TITLE = "HWR Moodle Scraper";

interface CleanMode { value: "delete" | "move"; label: string; flag?: string }

const MODES: CleanMode[] = [
  { value: "delete", label: "Delete — permanently remove user-added files" },
  { value: "move",   label: "Move   — relocate to User Files/ folder", flag: "--move" },
];

const MODE_COUNT = MODES.length;
// 1 toggle: dry-run
const RUN_IDX  = MODE_COUNT + 1;
const BACK_IDX = MODE_COUNT + 2;
const TOTAL    = MODE_COUNT + 3;

function buildCliCommand(modeIdx: number, dryRun: boolean): string {
  const parts = ["msc clean"];
  if (MODES[modeIdx]?.flag) parts.push(MODES[modeIdx]!.flag!);
  if (dryRun) parts.push("--dry-run");
  return parts.join(" ");
}

export async function cleanScreen(outputDir: string, promptFn: PromptFn, version: string): Promise<void> {
  if (!process.stdin.isTTY) {
    const answer = await promptFn("Run msc clean? [y/N] ");
    if (answer.trim().toLowerCase() !== "y") return;
    await runClean({ outputDir, move: false, dryRun: false, promptFn });
    return;
  }

  let modeIdx = 0;
  let dryRun = false;
  let focused = 0;
  let page = 1;

  function buildItems(): RenderItem[] {
    const items: RenderItem[] = [];
    items.push({ type: "text", content: "── Mode ──────────────────────────" });
    for (let i = 0; i < MODES.length; i++) {
      items.push({ type: "radio", label: MODES[i]!.label, selected: modeIdx === i, focused: focused === i });
    }
    items.push({ type: "blank" });
    items.push({ type: "text", content: "── Options ───────────────────────" });
    items.push({ type: "toggle", label: "Dry-run — preview only  (--dry-run)", checked: dryRun, focused: focused === MODE_COUNT });
    items.push({ type: "blank" });
    items.push({ type: "selector", label: "→  Run Clean", focused: focused === RUN_IDX });
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
      appTitle: APP_TITLE, version, title: "── Clean ──",
      items: pageItems, page, totalPages,
      footer: "↑↓ navigate  Enter/Space select/toggle  q back",
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
        if (focused < MODE_COUNT) {
          modeIdx = focused;
        } else if (focused === MODE_COUNT) {
          dryRun = !dryRun;
        } else if (focused === RUN_IDX) {
          const cliCmd = buildCliCommand(modeIdx, dryRun);

          if (!dryRun) {
            const confirmed = await showConfirm(version, "── Clean — Confirm ──", cliCmd, promptFn);
            if (!confirmed) { draw(); continue; }
          }

          clearTimeout(resizeTimer);
          process.stdout.removeListener("resize", onResize);
          process.stdout.write(SHOW_CURSOR);
          process.stdout.write("\u001b[2J\u001b[H");

          await runClean({
            outputDir,
            move: MODES[modeIdx]?.value === "move",
            dryRun,
            promptFn,
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
        if (item.type === "radio" || item.type === "toggle" || item.type === "selector") {
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
