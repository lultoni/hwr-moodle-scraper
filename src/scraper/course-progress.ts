/**
 * CourseProgressDisplay — live in-place per-course download progress table.
 *
 * Renders a compact table to stdout during download, redrawing each course
 * line in place using ANSI cursor-up when the counters change. Only active
 * when stdout is a TTY; non-TTY mode is a complete no-op.
 *
 * Pass 41 (Feature 4) — REQ-CLI-008
 */

const BAR_WIDTH = 20;
const MAX_NAME = 45;

const USE_COLOR = process.stdout.isTTY && !process.env["NO_COLOR"];
const C = {
  green:  USE_COLOR ? "\u001b[32m" : "",
  dim:    USE_COLOR ? "\u001b[2m"  : "",
  reset:  USE_COLOR ? "\u001b[0m"  : "",
  bold:   USE_COLOR ? "\u001b[1m"  : "",
};

export interface CourseEntry {
  courseId: number;
  name: string;
  total: number;
}

interface CourseState {
  name: string;
  done: number;
  total: number;
}

function renderBar(done: number, total: number): string {
  if (total === 0) return "░".repeat(BAR_WIDTH);
  const filled = Math.round((done / total) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function truncate(name: string): string {
  if (name.length > MAX_NAME) return name.slice(0, MAX_NAME - 1) + "…";
  return name.padEnd(MAX_NAME);
}

function renderLine(state: CourseState, isTTY: boolean): string {
  const bar = renderBar(state.done, state.total);
  const counter = `[${state.done}/${state.total}]`.padStart(10);
  const namePart = truncate(state.name);
  const done = state.done >= state.total && state.total > 0;
  if (isTTY && done) {
    return `  ${C.green}✓${C.reset} ${namePart}  ${counter}  ${C.dim}${bar}${C.reset}  done\n`;
  }
  return `  ⋯ ${namePart}  ${counter}  ${C.dim}${bar}${C.reset}\n`;
}

export class CourseProgressDisplay {
  private readonly isTTY: boolean;
  private courses: Map<number, CourseState> = new Map();
  private courseOrder: number[] = [];
  private linesDrawn = 0;

  constructor() {
    this.isTTY = Boolean(process.stdout.isTTY);
  }

  /** Print the initial course table. Must be called before tick(). */
  start(courses: CourseEntry[]): void {
    if (!this.isTTY) return;
    this.courses = new Map(
      courses.map((c) => [c.courseId, { name: c.name, done: 0, total: c.total }]),
    );
    this.courseOrder = courses.map((c) => c.courseId);
    this.linesDrawn = courses.length;
    for (const id of this.courseOrder) {
      const state = this.courses.get(id)!;
      process.stdout.write(renderLine(state, this.isTTY));
    }
  }

  /** Increment done counter for a course and redraw its line. */
  tick(courseId: number, _filename: string): void {
    if (!this.isTTY) return;
    const state = this.courses.get(courseId);
    if (!state) return;

    state.done = Math.min(state.done + 1, state.total);

    // Move cursor up to the course's line and redraw
    const lineIndex = this.courseOrder.indexOf(courseId);
    if (lineIndex < 0) return;
    const linesUp = this.linesDrawn - lineIndex;
    // Move up linesUp lines, overwrite the line, move back down
    process.stdout.write(`\x1b[${linesUp}A`);
    process.stdout.write(`\r\x1b[2K${renderLine(state, this.isTTY).trimEnd()}`);
    process.stdout.write(`\x1b[${linesUp - 1}B\r`);
  }

  /** Clear the current-file line and finalize display. */
  finish(): void {
    if (!this.isTTY) return;
    // Move to end of drawn block and emit a blank line separator
    process.stdout.write("\n");
  }
}
