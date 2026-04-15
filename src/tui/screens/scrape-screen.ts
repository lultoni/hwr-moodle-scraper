/**
 * TUI Scrape-Screen.
 *
 * Single screen: mode selector (radio) + options (toggles).
 * Shows a confirmation step with the equivalent CLI command before running.
 */

import { runScrape } from "../../commands/scrape.js";
import { readKey } from "../keys.js";
import { render, paginate, type RenderItem } from "../renderer.js";
import { SCRAPE_BOOL_OPTIONS } from "../options-registry.js";
import type { PromptFn } from "../../auth/prompt.js";

const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

const APP_TITLE = "HWR Moodle Scraper";

interface Mode {
  value: "normal" | "force" | "check" | "dry";
  label: string;
  flag?: string;
}

const MODES: Mode[] = [
  { value: "normal", label: "Normal — download new/changed files" },
  { value: "force",  label: "Force — re-download everything",      flag: "--force" },
  { value: "check",  label: "Check files — re-download missing",   flag: "--check-files" },
  { value: "dry",    label: "Dry-run — plan without downloading",  flag: "--dry-run" },
];

function buildCliCommand(mode: Mode, boolState: Record<string, boolean>, coursesFilter?: number[]): string {
  const parts = ["msc scrape"];
  if (mode.flag) parts.push(mode.flag);
  for (const opt of SCRAPE_BOOL_OPTIONS) {
    if (boolState[opt.key]) parts.push(`--${opt.key.replace(/([A-Z])/g, "-$1").toLowerCase()}`);
  }
  if (coursesFilter && coursesFilter.length > 0) parts.push(`--courses ${coursesFilter.join(",")}`);
  return parts.join(" ");
}

export async function scrapeScreen(outputDir: string, promptFn: PromptFn, version: string): Promise<void> {
  const boolState: Record<string, boolean> = {};
  for (const opt of SCRAPE_BOOL_OPTIONS) boolState[opt.key] = opt.default;

  let modeIdx = 0;
  let coursesFilter: number[] | undefined;
  // focusedRow: 0..MODES.length-1 = mode rows, MODES.length..MODES.length+SCRAPE_BOOL_OPTIONS.length-1 = toggles,
  // then "courses" row, then "Run" row
  const modCount = MODES.length;
  const optCount = SCRAPE_BOOL_OPTIONS.length;
  const totalRows = modCount + optCount + 2; // +2 for courses + run
  let focused = 0;
  let page = 1;

  function buildItems(): RenderItem[] {
    const items: RenderItem[] = [];
    items.push({ type: "text", content: "── Select mode ──────────────────" });
    for (let i = 0; i < MODES.length; i++) {
      items.push({ type: "radio", label: MODES[i]!.label, selected: modeIdx === i, focused: focused === i });
    }
    items.push({ type: "blank" });
    items.push({ type: "text", content: "── Options ──────────────────────" });
    for (let i = 0; i < SCRAPE_BOOL_OPTIONS.length; i++) {
      const opt = SCRAPE_BOOL_OPTIONS[i]!;
      items.push({ type: "toggle", label: opt.label, checked: boolState[opt.key]!, focused: focused === modCount + i });
    }
    items.push({ type: "blank" });
    const coursesTxt = coursesFilter ? coursesFilter.join(", ") : "all courses";
    items.push({ type: "selector", label: `Courses: ${coursesTxt}`, focused: focused === modCount + optCount });
    items.push({ type: "blank" });
    items.push({ type: "selector", label: "→  Run Scrape", focused: focused === modCount + optCount + 1 });
    return items;
  }

  function draw(): void {
    const rows = process.stdout.rows ?? 24;
    const allItems = buildItems();
    const { pageItems, totalPages } = paginate(allItems, page, rows);
    render({
      appTitle: APP_TITLE, version, title: "── Scrape ──",
      items: pageItems, page, totalPages,
      footer: "↑↓ navigate  Enter select/toggle  Space toggle  q back",
    });
  }

  process.stdout.write(HIDE_CURSOR);

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 50); };
  process.stdout.on("resize", onResize);

  draw();

  try {
    while (true) {
      const key = await readKey();

      if (key.name === "up") {
        focused = (focused - 1 + totalRows) % totalRows;
      } else if (key.name === "down") {
        focused = (focused + 1) % totalRows;
      } else if (key.name === "pageup") {
        focused = Math.max(0, focused - Math.max(1, (process.stdout.rows ?? 24) - 9));
      } else if (key.name === "pagedown") {
        focused = Math.min(totalRows - 1, focused + Math.max(1, (process.stdout.rows ?? 24) - 9));
      } else if (key.name === "escape" || (key.name === "char" && key.char === "q")) {
        return;
      } else if (key.name === "enter" || (key.name === "char" && key.char === " ")) {
        if (focused < modCount) {
          // Select mode
          modeIdx = focused;
        } else if (focused < modCount + optCount) {
          // Toggle option
          const optIdx = focused - modCount;
          const opt = SCRAPE_BOOL_OPTIONS[optIdx]!;
          boolState[opt.key] = !boolState[opt.key];
          if (boolState[opt.key] && opt.mutuallyExclusive) {
            for (const k of opt.mutuallyExclusive) boolState[k] = false;
          }
        } else if (focused === modCount + optCount) {
          // Courses picker
          process.stdout.write(SHOW_CURSOR);
          clearTimeout(resizeTimer);
          process.stdout.removeListener("resize", onResize);
          if (coursesFilter) {
            coursesFilter = undefined;
          } else {
            process.stdout.write("\nCourse IDs (comma-separated, e.g. 12345,67890): ");
            const input = await promptFn("");
            const ids = input.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
            coursesFilter = ids.length > 0 ? ids : undefined;
          }
          process.stdout.write(HIDE_CURSOR);
          process.stdout.on("resize", onResize);
        } else {
          // Run — show confirmation
          const mode = MODES[modeIdx]!;
          const cliCmd = buildCliCommand(mode, boolState, coursesFilter);

          const confirmed = await showConfirm(version, "── Scrape — Confirm ──", cliCmd, promptFn);
          if (!confirmed) { draw(); continue; }

          clearTimeout(resizeTimer);
          process.stdout.removeListener("resize", onResize);
          process.stdout.write(SHOW_CURSOR);

          try {
            await runScrape({
              outputDir,
              dryRun: mode.value === "dry",
              force: mode.value === "force",
              checkFiles: mode.value === "check",
              verbose: boolState["verbose"] ?? false,
              quiet: boolState["quiet"] ?? false,
              skipDiskCheck: boolState["skipDiskCheck"] ?? false,
              metadata: boolState["metadata"] ?? false,
              ...(coursesFilter !== undefined && { courses: coursesFilter }),
            });
          } catch (err) {
            process.stderr.write(`Error: ${(err as Error).message}\n`);
          }

          if (process.stdin.isTTY) {
            process.stdout.write("\nPress any key to return to menu...\n");
            await readKey();
          }
          return;
        }
      }

      // Update page to keep focused row visible
      const rows = process.stdout.rows ?? 24;
      const pageSize = Math.max(1, rows - 9);
      const allItems = buildItems();
      // Count which "visible item index" corresponds to focused
      let visIdx = 0;
      for (let idx = 0; idx < allItems.length; idx++) {
        const it = allItems[idx]!;
        if (it.type === "radio" || it.type === "toggle" || it.type === "selector") {
          if (it.focused) { page = Math.floor(visIdx / pageSize) + 1; break; }
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

/**
 * Show a confirmation screen with the CLI command that will run.
 * Returns true if confirmed, false if cancelled.
 */
export async function showConfirm(
  version: string,
  title: string,
  cliCmd: string,
  promptFn: PromptFn,
): Promise<boolean> {
  if (!process.stdin.isTTY) {
    const answer = await promptFn(`Run "${cliCmd}"? [y/N] `);
    return answer.trim().toLowerCase() === "y";
  }

  const HIDE_CURSOR = "\u001b[?25l";
  const SHOW_CURSOR = "\u001b[?25h";
  process.stdout.write(HIDE_CURSOR);

  let selected = 0; // 0 = Confirm, 1 = Back
  const items = ["Confirm", "Back"];

  function draw(): void {
    const renderItems: RenderItem[] = [
      { type: "blank" },
      { type: "text", content: "This will run:" },
      { type: "command", cmd: cliCmd },
      { type: "blank" },
      { type: "selector", label: items[0]!, focused: selected === 0 },
      { type: "selector", label: items[1]!, focused: selected === 1 },
    ];
    render({ appTitle: APP_TITLE, version, title, items: renderItems,
             footer: "↑↓ navigate  Enter confirm  q cancel" });
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 50); };
  process.stdout.on("resize", onResize);

  draw();

  try {
    while (true) {
      const key = await readKey();
      if (key.name === "up" || key.name === "down") {
        selected = selected === 0 ? 1 : 0;
        draw();
      } else if (key.name === "enter") {
        return selected === 0;
      } else if (key.name === "escape" || (key.name === "char" && key.char === "q")) {
        return false;
      }
    }
  } finally {
    clearTimeout(resizeTimer);
    process.stdout.removeListener("resize", onResize);
    process.stdout.write(SHOW_CURSOR);
  }
}
