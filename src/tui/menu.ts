/**
 * TUI main menu.
 *
 * Uses the shared renderer for a consistent box-drawing style.
 * Listens for terminal resize and re-renders without flicker.
 * Enter selects, q/Escape exits.
 */

import { readKey } from "./keys.js";
import { render, paginate, type RenderItem } from "./renderer.js";
import type { PromptFn } from "../auth/prompt.js";

const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

export interface MenuItem {
  label: string;
  hasSubmenu?: boolean;
  action: () => Promise<void>;
}

/** Run the main TUI menu loop. Returns when user quits. */
export async function runMenu(opts: {
  items: MenuItem[];
  title: string;
  version: string;
  promptFn: PromptFn;
}): Promise<void> {
  const { items, title, version, promptFn } = opts;

  if (!process.stdin.isTTY) {
    return runNonTtyMenu(items, promptFn);
  }

  process.stdout.write(HIDE_CURSOR);

  let selected = 0;
  let page = 1;

  function draw(): void {
    const { rows } = { rows: process.stdout.rows ?? 24 };
    const renderItems: RenderItem[] = items.map((item, i) => ({
      type: "selector" as const,
      label: item.hasSubmenu ? `${item.label}...` : item.label,
      focused: i === selected,
    }));
    const { pageItems, totalPages } = paginate(renderItems, page, rows);
    // Keep selection visible on current page
    const pageSize = Math.max(1, rows - 9);
    const correctPage = Math.floor(selected / pageSize) + 1;
    if (correctPage !== page) {
      page = correctPage;
      const repaged = paginate(renderItems, page, rows);
      render({
        appTitle: title, version,
        title: "── Main Menu ──",
        items: repaged.pageItems,
        page, totalPages: repaged.totalPages,
      });
      return;
    }
    render({ appTitle: title, version, title: "── Main Menu ──", items: pageItems, page, totalPages });
  }

  // Re-render on terminal resize (debounced)
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, 50);
  };
  process.stdout.on("resize", onResize);

  draw();

  try {
    while (true) {
      const key = await readKey();

      if (key.name === "up") {
        selected = (selected - 1 + items.length) % items.length;
      } else if (key.name === "down") {
        selected = (selected + 1) % items.length;
      } else if (key.name === "pageup") {
        selected = Math.max(0, selected - Math.max(1, (process.stdout.rows ?? 24) - 9));
      } else if (key.name === "pagedown") {
        selected = Math.min(items.length - 1, selected + Math.max(1, (process.stdout.rows ?? 24) - 9));
      } else if (key.name === "enter") {
        process.stdout.write(SHOW_CURSOR);
        await items[selected]!.action();
        process.stdout.write(HIDE_CURSOR);
      } else if (key.name === "escape" || (key.name === "char" && key.char === "q")) {
        return;
      }

      draw();
    }
  } finally {
    clearTimeout(resizeTimer);
    process.stdout.removeListener("resize", onResize);
    process.stdout.write(SHOW_CURSOR);
  }
}

async function runNonTtyMenu(items: MenuItem[], promptFn: PromptFn): Promise<void> {
  while (true) {
    process.stdout.write("\n--- Menu ---\n");
    items.forEach((item, i) => {
      process.stdout.write(`  ${i + 1}. ${item.label}\n`);
    });

    const answer = await promptFn(`Select [1-${items.length}] or q to quit: `);
    if (answer.trim().toLowerCase() === "q") return;

    const n = parseInt(answer.trim(), 10);
    if (!isNaN(n) && n >= 1 && n <= items.length) {
      await items[n - 1]!.action();
    }
  }
}
