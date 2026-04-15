/**
 * Shared full-screen renderer for all TUI screens.
 *
 * Design principles:
 * - Every render does a full clear + re-draw from top-left (no append/scroll)
 * - Width is dynamic: min(terminal width - 4, 72), never less than 40
 * - All content is clipped to the available content area (no overflow/scroll)
 * - Pagination is built-in: content that doesn't fit is split into pages
 */

// \u001b[3J erases scrollback so old screen content doesn't scroll into view
const CLEAR = "\u001b[3J\u001b[2J\u001b[H";

/** ANSI color/style escape codes. */
export const C = {
  reset:   "\u001b[0m",
  red:     "\u001b[38;5;196m",  // HWR red — header title only
  blue:    "\u001b[38;5;27m",   // blue — focused cursor + focused label
  dim:     "\u001b[2m",         // dim — footer hints
  dimItal: "\u001b[2;3m",       // dim + italic — Back / Quit navigation items
};

/** Strip ANSI escape sequences to measure visible character length. */
function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

export type RenderItem =
  | { type: "selector"; label: string; focused: boolean }
  | { type: "toggle";   label: string; checked: boolean; focused: boolean }
  | { type: "radio";    label: string; selected: boolean; focused: boolean }
  | { type: "text";     content: string }
  | { type: "command";  cmd: string }
  | { type: "blank" };

export interface ScreenState {
  /** App title shown in header (e.g. "HWR Moodle Scraper") */
  appTitle: string;
  /** App version shown in header (e.g. "v0.1.0") */
  version: string;
  /** Current screen name shown in subtitle (e.g. "── Scrape ──") */
  title: string;
  /** Items in the content area */
  items: RenderItem[];
  /** Optional footer override — default shows navigation hints */
  footer?: string;
  /** Current page (1-based) */
  page?: number;
  /** Total pages */
  totalPages?: number;
}

/** Get current terminal dimensions, with safe fallbacks. */
export function termSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

/** Compute the TUI box inner width from terminal columns. */
export function boxWidth(cols: number): number {
  return Math.max(40, Math.min(cols - 4, 72));
}

/**
 * Truncate or pad a string to exactly `width` VISIBLE characters.
 * Uses stripAnsi so ANSI codes don't count toward visible width.
 * Always operates on plain text — apply color AFTER calling fitLine.
 */
function fitLine(s: string, width: number): string {
  const vis = stripAnsi(s);
  if (vis.length > width) return s.slice(0, width - 1) + "…";
  return s + " ".repeat(width - vis.length);
}

/** Render one box line: ║ <content padded to content width> ║
 *  contentWidth = boxWidth - 2 (one space margin on each side)
 */
function boxLine(content: string, contentWidth: number): string {
  return `║ ${fitLine(content, contentWidth)} ║\n`;
}

/** Returns true for navigation items (Back / Quit). */
function isNavLabel(label: string): boolean {
  return label.startsWith("← ") || label === "Quit";
}

function renderItem(item: RenderItem, contentWidth: number): string {
  switch (item.type) {
    case "selector": {
      const cursor = item.focused ? ">" : " ";
      const plain = `  ${cursor} ${item.label}`;
      const fitted = fitLine(plain, contentWidth);
      if (item.focused) {
        return `║ ${C.blue}${fitted}${C.reset} ║\n`;
      }
      if (isNavLabel(item.label)) {
        return `║ ${C.dimItal}${fitted}${C.reset} ║\n`;
      }
      return `║ ${fitted} ║\n`;
    }
    case "toggle": {
      const cursor = item.focused ? ">" : " ";
      const box = item.checked ? "[x]" : "[ ]";
      const plain = `  ${cursor} ${box} ${item.label}`;
      const fitted = fitLine(plain, contentWidth);
      if (item.focused) return `║ ${C.blue}${fitted}${C.reset} ║\n`;
      return `║ ${fitted} ║\n`;
    }
    case "radio": {
      const cursor = item.focused ? ">" : " ";
      const dot = item.selected ? "(•)" : "( )";
      const plain = `  ${cursor} ${dot} ${item.label}`;
      const fitted = fitLine(plain, contentWidth);
      if (item.focused) return `║ ${C.blue}${fitted}${C.reset} ║\n`;
      return `║ ${fitted} ║\n`;
    }
    case "text":
      return boxLine(`  ${item.content}`, contentWidth);
    case "command":
      return boxLine(`  ↳ ${item.cmd}`, contentWidth);
    case "blank":
      return boxLine("", contentWidth);
  }
}

/**
 * Render the full screen to stdout.
 * Clears the screen, draws the box with dynamic width, content, footer.
 *
 * Geometry (all measured in terminal columns):
 *   w          = boxWidth(cols)          — total inner width incl. side spaces
 *   contentW   = w - 2                   — usable text width (one space each side)
 *   border     = ╔ + ═×w + ╗            — w + 2 cols wide
 *   box line   = ║ + space + text×(w-2) + space + ║  — w + 2 cols wide ✓
 */
export function render(state: ScreenState): void {
  const { cols } = termSize();
  const w = boxWidth(cols);      // inner width (the ═ run, also the space between ║ and ║)
  const contentW = w - 2;        // usable text width inside the margins
  const hr = "═".repeat(w);

  let out = CLEAR;

  // Top border
  out += `╔${hr}╗\n`;

  // Header: app title (HWR red) + version — inline to avoid ANSI-in-fitLine width issues
  const headerPlain = `${state.appTitle}  ${state.version}`;
  const headerFitted = fitLine(headerPlain, contentW);
  const headerColored = headerFitted.replace(state.appTitle, `${C.red}${state.appTitle}${C.reset}`);
  out += `║ ${headerColored} ║\n`;

  // Subtitle: screen name
  out += boxLine(state.title, contentW);

  // Separator
  out += `╠${hr}╣\n`;

  // Blank spacer
  out += boxLine("", contentW);

  // Content items
  for (const item of state.items) {
    out += renderItem(item, contentW);
  }

  // Blank spacer
  out += boxLine("", contentW);

  // Bottom separator
  out += `╠${hr}╣\n`;

  // Footer — inline with dim color, fitting plain text first
  let footerText = state.footer ?? "↑↓ navigate  Enter select  q back";
  if (state.totalPages && state.totalPages > 1) {
    footerText += `  [${state.page ?? 1}/${state.totalPages}] PgUp/PgDn`;
  }
  out += `║ ${C.dim}${fitLine(footerText, contentW)}${C.reset} ║\n`;

  // Bottom border
  out += `╚${hr}╝\n`;

  process.stdout.write(out);
}

/**
 * Paginate an item array to fit within the available content rows.
 * Returns the items for the current page and total page count.
 */
export function paginate(
  items: RenderItem[],
  page: number,
  rows: number,
): { pageItems: RenderItem[]; totalPages: number } {
  // Available rows: total - 8 (top border, header, subtitle, separator, 2 spacers, footer-sep, footer, bottom)
  const pageSize = Math.max(1, rows - 9);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.max(1, Math.min(page, totalPages));
  const start = (clampedPage - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), totalPages };
}
