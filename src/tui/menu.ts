/**
 * TUI Hauptmenü.
 *
 * Renders a box-drawing menu, navigated with ↑↓ arrow keys.
 * Uses full-screen clear on every redraw — no scroll artifacts.
 * Enter selects, q/Escape exits.
 */

import { readKey } from "./keys.js";
import type { PromptFn } from "../auth/prompt.js";

export interface MenuItem {
  label: string;
  action: () => Promise<void>;
}

const CLEAR = "\u001b[2J\u001b[H";   // clear screen + cursor to top-left
const HIDE_CURSOR = "\u001b[?25l";   // hide cursor
const SHOW_CURSOR = "\u001b[?25h";   // show cursor

/** Draw the menu box to stdout. */
function renderMenu(items: MenuItem[], selected: number, title: string, version: string): void {
  const width = 40;
  const hr = "═".repeat(width - 2);
  const lines: string[] = [];

  lines.push(`╔${hr}╗`);
  lines.push(`║  ${title.padEnd(width - 4)}║`);
  lines.push(`║  ${version.padEnd(width - 4)}║`);
  lines.push(`╠${hr}╣`);
  lines.push(`║${"".padEnd(width - 2)}║`);

  for (let i = 0; i < items.length; i++) {
    const cursor = i === selected ? ">" : " ";
    const itemLabel = `  ${cursor} ${items[i]!.label}`;
    lines.push(`║${itemLabel.padEnd(width - 2)}║`);
  }

  lines.push(`║${"".padEnd(width - 2)}║`);
  lines.push(`║  ${"↑↓ navigate  Enter select  q quit".padEnd(width - 4)}║`);
  lines.push(`╚${hr}╝`);

  process.stdout.write(lines.join("\n") + "\n");
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

  // Enter full-screen mode
  process.stdout.write(HIDE_CURSOR);
  let selected = 0;

  while (true) {
    process.stdout.write(CLEAR);
    renderMenu(items, selected, title, version);

    const key = await readKey();

    if (key.name === "up") {
      selected = (selected - 1 + items.length) % items.length;
    } else if (key.name === "down") {
      selected = (selected + 1) % items.length;
    } else if (key.name === "enter") {
      // Show cursor while action runs (action may print prompts/output)
      process.stdout.write(SHOW_CURSOR + CLEAR);
      await items[selected]!.action();
      process.stdout.write(HIDE_CURSOR);
    } else if (key.name === "escape" || (key.name === "char" && key.char === "q")) {
      process.stdout.write(SHOW_CURSOR + CLEAR);
      return;
    }
  }
}

async function runNonTtyMenu(items: MenuItem[], promptFn: PromptFn): Promise<void> {
  while (true) {
    process.stdout.write("\n--- Menu ---\n");
    items.forEach((item, i) => {
      process.stdout.write(`  ${i + 1}. ${item.label}\n`);
    });

    const answer = await promptFn(`Select [1-${items.length}] or q to quit: `);
    if (answer.trim().toLowerCase() === "q") {
      return;
    }

    const n = parseInt(answer.trim(), 10);
    if (!isNaN(n) && n >= 1 && n <= items.length) {
      await items[n - 1]!.action();
    }
  }
}
