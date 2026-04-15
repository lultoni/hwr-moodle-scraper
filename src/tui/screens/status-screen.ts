/**
 * TUI Status-Screen.
 * Radio selector for view mode (summary / issues / changed) + Run button.
 * Read-only operation — no confirmation step needed.
 */

import { runStatus } from "../../commands/status.js";
import { readKey } from "../keys.js";
import { render, paginate, C, type RenderItem } from "../renderer.js";
import type { PromptFn } from "../../auth/prompt.js";

const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const APP_TITLE = "HWR Moodle Scraper";

interface ViewMode {
  value: "summary" | "issues" | "changed";
  label: string;
  flag?: string;
}

const VIEWS: ViewMode[] = [
  { value: "summary", label: "Summary — last sync overview" },
  { value: "issues",  label: "Issues  — missing / orphaned / user files", flag: "--issues" },
  { value: "changed", label: "Changed — files updated in last run",       flag: "--changed" },
];

// Focusable row indices:
// 0..VIEWS.length-1 = radio rows
// VIEWS.length      = Run button
// VIEWS.length + 1  = ← Back
const RUN_IDX  = VIEWS.length;
const BACK_IDX = VIEWS.length + 1;
const TOTAL    = VIEWS.length + 2;

function buildCliCommand(viewIdx: number): string {
  const flag = VIEWS[viewIdx]?.flag;
  return flag ? `msc status ${flag}` : "msc status";
}

export async function statusScreen(outputDir: string, promptFn: PromptFn, version: string): Promise<void> {
  if (!process.stdin.isTTY) {
    // Non-TTY: run summary directly
    await runStatus({ outputDir, showIssues: false });
    return;
  }

  let viewIdx = 0;
  let focused = 0;
  let page = 1;

  function buildItems(): RenderItem[] {
    const items: RenderItem[] = [];
    items.push({ type: "text", content: "── View ──────────────────────────" });
    for (let i = 0; i < VIEWS.length; i++) {
      items.push({ type: "radio", label: VIEWS[i]!.label, selected: viewIdx === i, focused: focused === i });
    }
    items.push({ type: "blank" });
    items.push({ type: "selector", label: "→  Run Status", focused: focused === RUN_IDX });
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
      appTitle: APP_TITLE, version, title: "── Status ──",
      items: pageItems, page, totalPages,
      footer: "↑↓ navigate  Enter/Space select  q back",
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
        if (focused < VIEWS.length) {
          viewIdx = focused;
        } else if (focused === RUN_IDX) {
          clearTimeout(resizeTimer);
          process.stdout.removeListener("resize", onResize);
          process.stdout.write(SHOW_CURSOR);
          process.stdout.write("\u001b[2J\u001b[H");
          await runStatus({
            outputDir,
            showIssues: VIEWS[viewIdx]?.value === "issues",
            showChanged: VIEWS[viewIdx]?.value === "changed",
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
