/**
 * Reusable spinners for async and event-driven operations.
 * Animates in TTY environments; silent in non-TTY (pipes, tests).
 */

import { HIDE_CURSOR, SHOW_CURSOR } from "./renderer.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Create an event-driven spinner that can be started and stopped explicitly.
 * Useful for multi-phase operations driven by callbacks.
 */
export function makeSpinner(): { start(label: string): void; end(): void } {
  let iv: ReturnType<typeof setInterval> | undefined;
  let frame = 0;
  let currentLabel = "";
  return {
    start(label: string) {
      currentLabel = label;
      frame = 0;
      process.stdout.write(HIDE_CURSOR);
      iv = setInterval(() => {
        process.stdout.write(`\r${FRAMES[frame++ % FRAMES.length]} ${currentLabel}  `);
      }, 80);
    },
    end() {
      if (!iv) return;
      clearInterval(iv);
      iv = undefined;
      const pad = " ".repeat(currentLabel.length + 4);
      process.stdout.write(`\r${pad}\r`);
      process.stdout.write(SHOW_CURSOR);
    },
  };
}

/**
 * Run `fn` while showing an animated spinner with `label`.
 * Clears the spinner line when done (success or error).
 */
export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) return fn();
  const spinner = makeSpinner();
  spinner.start(label);
  try {
    return await fn();
  } finally {
    spinner.end();
  }
}
