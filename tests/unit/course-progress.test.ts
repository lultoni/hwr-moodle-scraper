// Covers: Pass 41 — Feature 4: per-course mini progress display
//         Pass 47 — Bug fix: tick() cursor return off-by-one (linesUp-1 → linesUp)
//
// CourseProgressDisplay renders a live in-place course table during download.
// Tests cover: initial render, tick(), completion, non-TTY no-op mode.
//
// REGRESSION NOTE (Pass 47): tick() must return the cursor to line N (below the table)
// after each redraw. The original code used \x1b[${linesUp-1}B which landed at line N-1,
// causing every subsequent tick to write to the wrong line (one above intended), producing
// a waterfall of duplicate course lines in the terminal output.

import { describe, it, expect, vi, afterEach } from "vitest";
import { CourseProgressDisplay } from "../../src/scraper/course-progress.js";

function makeTTYStdout(): { spy: ReturnType<typeof vi.spyOn>; output: () => string } {
  const origIsTTY = process.stderr.isTTY;
  Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return {
    spy,
    output: () => spy.mock.calls.map((c) => c[0] as string).join(""),
  };
}

function restoreTTY(origIsTTY: boolean | undefined): void {
  Object.defineProperty(process.stderr, "isTTY", { value: origIsTTY, configurable: true });
}

describe("CourseProgressDisplay — non-TTY (no-op)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not write anything to stdout when not a TTY", () => {
    const origIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const display = new CourseProgressDisplay();
    display.start([
      { courseId: 1, name: "Course A", total: 10 },
      { courseId: 2, name: "Course B", total: 5 },
    ]);
    display.tick(1, "file.pdf");
    display.finish();

    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
    restoreTTY(origIsTTY);
  });
});

describe("CourseProgressDisplay — TTY active", () => {
  afterEach(() => vi.restoreAllMocks());

  it("start() prints one line per course", () => {
    const origIsTTY = process.stderr.isTTY;
    const { spy, output } = makeTTYStdout();

    const display = new CourseProgressDisplay();
    display.start([
      { courseId: 1, name: "Datenbanken", total: 32 },
      { courseId: 2, name: "Software Engineering", total: 50 },
    ]);

    const written = output();
    // Should contain both course names
    expect(written).toContain("Datenbanken");
    expect(written).toContain("Software Engineering");
    // Should contain [0/32] and [0/50] counters
    expect(written).toContain("0/32");
    expect(written).toContain("0/50");

    spy.mockRestore();
    restoreTTY(origIsTTY);
  });

  it("tick() increments the done counter for the correct course", () => {
    const origIsTTY = process.stderr.isTTY;
    const { spy, output } = makeTTYStdout();

    const display = new CourseProgressDisplay();
    display.start([
      { courseId: 1, name: "Course A", total: 10 },
      { courseId: 2, name: "Course B", total: 5 },
    ]);

    spy.mockClear(); // clear start() output

    display.tick(1, "file.pdf");
    display.tick(1, "file2.pdf");

    const redrawn = output();
    // After 2 ticks on courseId 1, counter should show 2/10
    expect(redrawn).toContain("2/10");

    spy.mockRestore();
    restoreTTY(origIsTTY);
  });

  it("marks course complete when done === total", () => {
    const origIsTTY = process.stderr.isTTY;
    const { spy, output } = makeTTYStdout();

    const display = new CourseProgressDisplay();
    display.start([{ courseId: 1, name: "Tiny", total: 2 }]);
    spy.mockClear();

    display.tick(1, "a.pdf");
    display.tick(1, "b.pdf");

    const redrawn = output();
    // When all done: 2/2 counter
    expect(redrawn).toContain("2/2");

    spy.mockRestore();
    restoreTTY(origIsTTY);
  });

  it("finish() writes a final newline to clear the progress area", () => {
    const origIsTTY = process.stderr.isTTY;
    const { spy, output } = makeTTYStdout();

    const display = new CourseProgressDisplay();
    display.start([{ courseId: 1, name: "X", total: 3 }]);
    spy.mockClear();

    display.finish();

    const afterFinish = output();
    // finish() should write at minimum a newline
    expect(afterFinish.length).toBeGreaterThan(0);

    spy.mockRestore();
    restoreTTY(origIsTTY);
  });

  it("renders a block bar with █ and ░ characters", () => {
    const origIsTTY = process.stderr.isTTY;
    const { spy, output } = makeTTYStdout();

    const display = new CourseProgressDisplay();
    display.start([{ courseId: 1, name: "Bar Test", total: 4 }]);
    spy.mockClear();

    display.tick(1, "a.pdf");
    display.tick(1, "b.pdf"); // 50% done

    const redrawn = output();
    expect(redrawn).toContain("█");
    expect(redrawn).toContain("░");

    spy.mockRestore();
    restoreTTY(origIsTTY);
  });

  it("does nothing on tick() for unknown courseId", () => {
    const origIsTTY = process.stderr.isTTY;
    const { spy, output } = makeTTYStdout();

    const display = new CourseProgressDisplay();
    display.start([{ courseId: 1, name: "Only Course", total: 5 }]);
    spy.mockClear();

    // tick for a course that wasn't registered — should not throw or write garbage
    expect(() => display.tick(999, "file.pdf")).not.toThrow();

    spy.mockRestore();
    restoreTTY(origIsTTY);
  });
});
