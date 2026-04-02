/**
 * Arrow-key list selector.
 *
 * In a TTY: renders items with an arrow cursor, navigated by ↑↓ keys.
 * In a non-TTY (CI, pipe, test): falls back to numbered prompt via promptFn.
 */

import { readKey } from "./keys.js";
import type { PromptFn } from "../auth/prompt.js";

export interface SelectOptions<T> {
  title: string;
  items: Array<{ label: string; value: T }>;
  /** Fallback for non-TTY environments (tests, pipes). */
  promptFn: PromptFn;
}

/** Render the selection list to stdout, returning the number of lines written. */
function renderList<T>(items: Array<{ label: string; value: T }>, selected: number, title: string): void {
  process.stdout.write(`${title}\n`);
  for (let i = 0; i < items.length; i++) {
    const cursor = i === selected ? ">" : " ";
    process.stdout.write(`  ${cursor} ${items[i]!.label}\n`);
  }
}

/** Erase `lines` lines upward (move cursor up and clear each line). */
function eraseLines(lines: number): void {
  for (let i = 0; i < lines; i++) {
    process.stdout.write("\u001b[1A\u001b[2K"); // cursor up + erase line
  }
}

/**
 * Present an interactive selection list to the user.
 * Returns the `.value` of the chosen item.
 */
export async function selectItem<T>({ title, items, promptFn }: SelectOptions<T>): Promise<T> {
  // Non-TTY fallback: numbered list via promptFn
  if (!process.stdin.isTTY) {
    return nonTtySelect(title, items, promptFn);
  }

  // TTY: arrow-key navigation
  let selected = 0;
  renderList(items, selected, title);

  while (true) {
    const key = await readKey();

    // Erase the rendered list (title + items)
    eraseLines(items.length + 1);

    if (key.name === "up") {
      selected = (selected - 1 + items.length) % items.length;
    } else if (key.name === "down") {
      selected = (selected + 1) % items.length;
    } else if (key.name === "enter") {
      // Print the final selection and return
      process.stdout.write(`${title}\n`);
      process.stdout.write(`  > ${items[selected]!.label}\n`);
      return items[selected]!.value;
    } else if (key.name === "escape" || (key.name === "char" && key.char === "q")) {
      // Treat escape/q as selecting the last item (conventionally "skip")
      const last = items.length - 1;
      process.stdout.write(`${title}\n`);
      process.stdout.write(`  > ${items[last]!.label}\n`);
      return items[last]!.value;
    }

    renderList(items, selected, title);
  }
}

async function nonTtySelect<T>(
  title: string,
  items: Array<{ label: string; value: T }>,
  promptFn: PromptFn,
): Promise<T> {
  process.stdout.write(`${title}\n`);
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
