/**
 * Shared full-screen renderer for all TUI screens.
 *
 * Design principles:
 * - Every render does a full clear + re-draw from top-left (no append/scroll)
 * - Width is dynamic: min(terminal width - 4, 72), never less than 40
 * - All content is clipped to the available content area (no overflow/scroll)
 * - Pagination is built-in: content that doesn't fit is split into pages
 */

const CLEAR = "\u001b[2J\u001b[H";

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

/** Truncate or pad a string to exactly `width` characters (visible chars, no ANSI). */
function fitLine(s: string, width: number): string {
  if (s.length > width) return s.slice(0, width - 1) + "…";
  return s.padEnd(width);
}

/** Render one box line: ║ <content padded to inner width> ║ */
function boxLine(content: string, innerWidth: number): string {
  return `║ ${fitLine(content, innerWidth - 1)} ║\n`;
}

function renderItem(item: RenderItem, innerWidth: number): string {
  switch (item.type) {
    case "selector": {
      const cursor = item.focused ? ">" : " ";
      return boxLine(`  ${cursor} ${item.label}`, innerWidth);
    }
    case "toggle": {
      const cursor = item.focused ? ">" : " ";
      const box = item.checked ? "[x]" : "[ ]";
      return boxLine(`  ${cursor} ${box} ${item.label}`, innerWidth);
    }
    case "radio": {
      const cursor = item.focused ? ">" : " ";
      const dot = item.selected ? "(•)" : "( )";
      return boxLine(`  ${cursor} ${dot} ${item.label}`, innerWidth);
    }
    case "text":
      return boxLine(`  ${item.content}`, innerWidth);
    case "command":
      return boxLine(`  ↳ ${item.cmd}`, innerWidth);
    case "blank":
      return boxLine("", innerWidth);
  }
}

/**
 * Render the full screen to stdout.
 * Clears the screen, draws the box with dynamic width, content, footer.
 */
export function render(state: ScreenState): void {
  const { cols } = termSize();
  const w = boxWidth(cols); // inner width (between ║ and ║)
  const hr = "═".repeat(w + 1); // +1 for the space after ║

  let out = CLEAR;

  // Top border
  out += `╔${hr}╗\n`;

  // Header: app title + version
  const header = `${state.appTitle}  ${state.version}`;
  out += boxLine(header, w + 1);

  // Subtitle: screen name
  out += boxLine(state.title, w + 1);

  // Separator
  out += `╠${hr}╣\n`;

  // Blank spacer
  out += boxLine("", w + 1);

  // Content items
  for (const item of state.items) {
    out += renderItem(item, w + 1);
  }

  // Blank spacer
  out += boxLine("", w + 1);

  // Bottom separator
  out += `╠${hr}╣\n`;

  // Footer
  let footerText = state.footer ?? "↑↓ navigate  Enter select  q back";
  if (state.totalPages && state.totalPages > 1) {
    footerText += `  [${state.page ?? 1}/${state.totalPages}] PgUp/PgDn`;
  }
  out += boxLine(footerText, w + 1);

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
