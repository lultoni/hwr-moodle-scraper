/**
 * Shared CLI print utilities.
 *
 * Color is applied when stdout is a TTY and NO_COLOR is not set.
 * Non-TTY output (pipes, tests) is always plain text — no ANSI codes.
 */

const USE_COLOR = process.stdout.isTTY && !process.env["NO_COLOR"];

const C = {
  reset:   USE_COLOR ? "\u001b[0m"   : "",
  green:   USE_COLOR ? "\u001b[32m"  : "",
  yellow:  USE_COLOR ? "\u001b[33m"  : "",
  red:     USE_COLOR ? "\u001b[31m"  : "",
  dim:     USE_COLOR ? "\u001b[2m"   : "",
  dimItal: USE_COLOR ? "\u001b[2;3m" : "",
};

export const ui = {
  /** Green — completed actions, confirmations, "valid" state */
  success: (msg: string) => process.stdout.write(`${C.green}${msg}${C.reset}\n`),
  /** Yellow — warnings, destructive action previews, "not set" states */
  warn:    (msg: string) => process.stdout.write(`${C.yellow}${msg}${C.reset}\n`),
  /** Red — errors (used sparingly; most errors go to stderr via logger) */
  error:   (msg: string) => process.stdout.write(`${C.red}${msg}${C.reset}\n`),
  /** Dim/grey — informational lines, progress context, neutral status */
  info:    (msg: string) => process.stdout.write(`${C.dim}${msg}${C.reset}\n`),
  /** Dim + italic — tips, hints, navigational prompts */
  hint:    (msg: string) => process.stdout.write(`${C.dimItal}${msg}${C.reset}\n`),
  /** No color — structured output: tables, trees, file lists, example blocks */
  plain:   (msg: string) => process.stdout.write(`${msg}\n`),
};
