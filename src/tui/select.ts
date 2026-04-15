/**
 * Reusable full-screen selection list.
 *
 * Wraps the shared renderer for one-shot item selection.
 * The caller provides items and gets back the chosen value.
 * Used by all screens that present a simple "pick one" choice.
 */

import { readKey } from "./keys.js";
import { render, paginate, HIDE_CURSOR, SHOW_CURSOR, type RenderItem } from "./renderer.js";
import type { PromptFn } from "../auth/prompt.js";

export interface SelectOptions<T> {
  appTitle: string;
  version: string;
  screenTitle: string;
  items: Array<{ label: string; value: T }>;
  footer?: string;
  /** Fallback for non-TTY environments (tests, pipes). */
  promptFn: PromptFn;
}

/**
 * Present an interactive selection list using the shared renderer.
 * Returns the `.value` of the chosen item.
 */
export async function selectItem<T>({
  appTitle, version, screenTitle, items, footer, promptFn,
}: SelectOptions<T>): Promise<T> {
  if (!process.stdin.isTTY) {
    return nonTtySelect(items, promptFn);
  }

  process.stdout.write(HIDE_CURSOR);

  let selected = 0;
  let page = 1;

  function draw(): void {
    const rows = process.stdout.rows ?? 24;
    const pageSize = Math.max(1, rows - 9);
    const correctPage = Math.floor(selected / pageSize) + 1;
    if (correctPage !== page) page = correctPage;

    const renderItems: RenderItem[] = items.map((item, i) => ({
      type: "selector" as const,
      label: item.label,
      focused: i === selected,
    }));
    const { pageItems, totalPages } = paginate(renderItems, page, rows);
    render({ appTitle, version, title: screenTitle, items: pageItems, ...(footer !== undefined && { footer }), page, totalPages });
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 50); };
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
        return items[selected]!.value;
      } else if (key.name === "escape" || (key.name === "char" && key.char === "q")) {
        return items[items.length - 1]!.value;
      }

      draw();
    }
  } finally {
    clearTimeout(resizeTimer);
    process.stdout.removeListener("resize", onResize);
    process.stdout.write(SHOW_CURSOR);
  }
}

async function nonTtySelect<T>(
  items: Array<{ label: string; value: T }>,
  promptFn: PromptFn,
): Promise<T> {
  items.forEach((item, i) => {
    process.stdout.write(`  ${i + 1}. ${item.label}\n`);
  });

  while (true) {
    const answer = await promptFn(`Select [1-${items.length}]: `);
    const n = parseInt(answer.trim(), 10);
    if (!isNaN(n) && n >= 1 && n <= items.length) {
      return items[n - 1]!.value;
    }
    process.stdout.write(`Please enter a number between 1 and ${items.length}.\n`);
  }
}
