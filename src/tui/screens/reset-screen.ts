/**
 * TUI Reset-Screen.
 * Radio for scope (partial/full) + toggles for options + Run button.
 * Always confirms with the equivalent CLI command before acting.
 */

import { runReset } from "../../commands/reset.js";
import { readKey } from "../keys.js";
import { render, paginate, type RenderItem } from "../renderer.js";
import { showConfirm } from "./scrape-screen.js";
import type { PromptFn } from "../../auth/prompt.js";

const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const APP_TITLE = "HWR Moodle Scraper";

interface Scope { value: "partial" | "full"; label: string; flag?: string }
interface ResetToggle { key: "moveUserFiles" | "dryRun"; label: string; flag: string }

const SCOPES: Scope[] = [
  { value: "partial", label: "Partial — delete scraped files + state" },
  { value: "full",    label: "Full    — also clear config + credentials", flag: "--full" },
];

const TOGGLES: ResetToggle[] = [
  { key: "moveUserFiles", label: "Move user files first  (--move-user-files)", flag: "--move-user-files" },
  { key: "dryRun",        label: "Dry-run — preview only  (--dry-run)",         flag: "--dry-run" },
];

const SCOPE_COUNT  = SCOPES.length;
const TOGGLE_COUNT = TOGGLES.length;
const RUN_IDX      = SCOPE_COUNT + TOGGLE_COUNT;
const BACK_IDX     = SCOPE_COUNT + TOGGLE_COUNT + 1;
const TOTAL        = SCOPE_COUNT + TOGGLE_COUNT + 2;

function buildCliCommand(scopeIdx: number, boolState: Record<string, boolean>): string {
  const parts = ["msc reset"];
  if (SCOPES[scopeIdx]?.flag) parts.push(SCOPES[scopeIdx]!.flag!);
  for (const t of TOGGLES) { if (boolState[t.key]) parts.push(t.flag); }
  return parts.join(" ");
}

export async function resetScreen(outputDir: string, promptFn: PromptFn, version: string): Promise<void> {
  if (!process.stdin.isTTY) {
    const answer = await promptFn("Run msc reset? [y/N] ");
    if (answer.trim().toLowerCase() !== "y") return;
    await runReset({ outputDir, promptFn });
    return;
  }

  let scopeIdx = 0;
  const boolState: Record<string, boolean> = { moveUserFiles: false, dryRun: false };
  let focused = 0;
  let page = 1;

  function buildItems(): RenderItem[] {
    const items: RenderItem[] = [];
    items.push({ type: "text", content: "── Scope ─────────────────────────" });
    for (let i = 0; i < SCOPES.length; i++) {
      items.push({ type: "radio", label: SCOPES[i]!.label, selected: scopeIdx === i, focused: focused === i });
    }
    items.push({ type: "blank" });
    items.push({ type: "text", content: "── Options ───────────────────────" });
    for (let i = 0; i < TOGGLES.length; i++) {
      const t = TOGGLES[i]!;
      items.push({ type: "toggle", label: t.label, checked: boolState[t.key]!, focused: focused === SCOPE_COUNT + i });
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
        if (focused < SCOPE_COUNT) {
          scopeIdx = focused;
        } else if (focused < SCOPE_COUNT + TOGGLE_COUNT) {
          const t = TOGGLES[focused - SCOPE_COUNT]!;
          boolState[t.key] = !boolState[t.key];
        } else if (focused === RUN_IDX) {
          const cliCmd = buildCliCommand(scopeIdx, boolState);
          const confirmed = await showConfirm(version, "── Reset — Confirm ──", cliCmd, promptFn);
          if (!confirmed) { draw(); continue; }

          clearTimeout(resizeTimer);
          process.stdout.removeListener("resize", onResize);
          process.stdout.write(SHOW_CURSOR);
          process.stdout.write("\u001b[2J\u001b[H");

          await runReset({
            outputDir,
            promptFn,
            full: SCOPES[scopeIdx]?.value === "full",
            moveUserFiles: boolState["moveUserFiles"] === true,
            dryRun: boolState["dryRun"] === true,
          });

          if (process.stdin.isTTY) {
            process.stdout.write("\nPress any key to return to menu...\n");
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
