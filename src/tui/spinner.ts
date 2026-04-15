/**
 * Reusable async spinner for async operations.
 * Animates in TTY environments; silent in non-TTY (pipes, tests).
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Run `fn` while showing an animated spinner with `label`.
 * Clears the spinner line when done (success or error).
 */
export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) return fn();

  process.stdout.write("\u001b[?25l"); // hide cursor
  let i = 0;
  const pad = " ".repeat(label.length + 4);
  const iv = setInterval(() => {
    process.stdout.write(`\r${FRAMES[i++ % FRAMES.length]} ${label}  `);
  }, 80);

  try {
    return await fn();
  } finally {
    clearInterval(iv);
    process.stdout.write(`\r${pad}\r`);
    process.stdout.write("\u001b[?25h"); // restore cursor
  }
}
