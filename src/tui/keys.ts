/**
 * Raw-mode keyboard input for TTY environments.
 * Uses Node.js built-in `tty` and `process.stdin` — zero external dependencies.
 */

export interface KeyEvent {
  name: "up" | "down" | "left" | "right" | "enter" | "escape" | "char";
  char?: string;
}

/**
 * Read a single keypress from stdin in raw mode.
 * Resolves with a KeyEvent describing the pressed key.
 *
 * Only call this when process.stdin.isTTY is true.
 */
export function readKey(): Promise<KeyEvent> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function onData(key: string) {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener("data", onData);

      // Escape sequences
      if (key === "\u001b[A") return resolve({ name: "up" });
      if (key === "\u001b[B") return resolve({ name: "down" });
      if (key === "\u001b[C") return resolve({ name: "right" });
      if (key === "\u001b[D") return resolve({ name: "left" });
      if (key === "\r" || key === "\n") return resolve({ name: "enter" });
      if (key === "\u001b") return resolve({ name: "escape" });
      // Ctrl+C / Ctrl+D — restore cursor and exit cleanly
      if (key === "\u0003" || key === "\u0004") {
        process.stdout.write("\u001b[?25h\n"); // show cursor
        process.exit(0);
      }
      resolve({ name: "char", char: key });
    }

    stdin.on("data", onData);
  });
}
