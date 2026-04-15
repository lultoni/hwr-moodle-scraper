// Tests for src/tui/renderer.ts and src/tui/options-registry.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, paginate, boxWidth, termSize, type RenderItem, type ScreenState } from "../../src/tui/renderer.js";
import { SCRAPE_BOOL_OPTIONS } from "../../src/tui/options-registry.js";
import { USER_EDITABLE_KEYS } from "../../src/config.js";

// ─── renderer: boxWidth ──────────────────────────────────────────────────────

describe("boxWidth()", () => {
  it("returns 40 for very narrow terminals", () => {
    expect(boxWidth(20)).toBe(40);
    expect(boxWidth(40)).toBe(40);
    expect(boxWidth(44)).toBe(40);
  });

  it("returns cols - 4 for mid-width terminals", () => {
    expect(boxWidth(60)).toBe(56);
    expect(boxWidth(70)).toBe(66);
  });

  it("caps at 72 for wide terminals", () => {
    expect(boxWidth(80)).toBe(72);
    expect(boxWidth(120)).toBe(72);
    expect(boxWidth(200)).toBe(72);
  });

  it("returns exactly 72 when cols = 76", () => {
    expect(boxWidth(76)).toBe(72);
  });
});

// ─── renderer: paginate ──────────────────────────────────────────────────────

describe("paginate()", () => {
  function makeItems(n: number): RenderItem[] {
    return Array.from({ length: n }, (_, i) => ({
      type: "selector" as const,
      label: `Item ${i + 1}`,
      focused: false,
    }));
  }

  it("returns all items when they fit on one page", () => {
    const items = makeItems(5);
    const { pageItems, totalPages } = paginate(items, 1, 24);
    expect(totalPages).toBe(1);
    expect(pageItems).toHaveLength(5);
  });

  it("splits 20 items into 4 pages with pageSize 5 (rows=14)", () => {
    // rows=14, pageSize = max(1, 14-9) = 5
    const items = makeItems(20);
    const { pageItems: p1, totalPages } = paginate(items, 1, 14);
    expect(totalPages).toBe(4);
    expect(p1).toHaveLength(5);
    expect((p1[0] as { label: string }).label).toBe("Item 1");

    const { pageItems: p2 } = paginate(items, 2, 14);
    expect(p2).toHaveLength(5);
    expect((p2[0] as { label: string }).label).toBe("Item 6");

    const { pageItems: p4 } = paginate(items, 4, 14);
    expect(p4).toHaveLength(5);
    expect((p4[4] as { label: string }).label).toBe("Item 20");
  });

  it("clamps page to valid range", () => {
    const items = makeItems(10);
    // 10 items, rows=14 (pageSize=5) → 2 pages
    const { pageItems, totalPages } = paginate(items, 99, 14);
    expect(totalPages).toBe(2);
    expect(pageItems).toHaveLength(5);
    expect((pageItems[0] as { label: string }).label).toBe("Item 6");
  });

  it("handles page 0 by returning page 1", () => {
    const items = makeItems(10);
    const { pageItems } = paginate(items, 0, 14);
    expect((pageItems[0] as { label: string }).label).toBe("Item 1");
  });

  it("returns 1 total page for empty array", () => {
    const { pageItems, totalPages } = paginate([], 1, 24);
    expect(totalPages).toBe(1);
    expect(pageItems).toHaveLength(0);
  });

  it("uses pageSize of at least 1 even for tiny terminals", () => {
    const items = makeItems(3);
    // rows=1, pageSize = max(1, 1-9) = 1
    const { totalPages } = paginate(items, 1, 1);
    expect(totalPages).toBe(3);
  });
});

// ─── renderer: render() output ───────────────────────────────────────────────

describe("render()", () => {
  let output: string;
  let originalWrite: typeof process.stdout.write;
  let originalColumns: number | undefined;
  let originalRows: number | undefined;

  beforeEach(() => {
    output = "";
    originalWrite = process.stdout.write.bind(process.stdout);
    originalColumns = process.stdout.columns;
    originalRows = process.stdout.rows;

    // Fix terminal dimensions for deterministic output
    Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
    Object.defineProperty(process.stdout, "rows",    { value: 24, configurable: true });

    vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
      output += s.toString();
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdout, "columns", { value: originalColumns, configurable: true });
    Object.defineProperty(process.stdout, "rows",    { value: originalRows,    configurable: true });
  });

  function makeState(overrides: Partial<ScreenState> = {}): ScreenState {
    return {
      appTitle: "HWR Moodle Scraper",
      version: "v1.0.0",
      title: "── Test ──",
      items: [],
      ...overrides,
    };
  }

  it("starts with ANSI clear sequence", () => {
    render(makeState());
    expect(output.startsWith("\u001b[3J\u001b[2J\u001b[H")).toBe(true);
  });

  it("includes app title and version in header", () => {
    render(makeState());
    expect(output).toContain("HWR Moodle Scraper");
    expect(output).toContain("v1.0.0");
  });

  it("includes screen title", () => {
    render(makeState({ title: "── Scrape ──" }));
    expect(output).toContain("── Scrape ──");
  });

  it("uses box-drawing characters", () => {
    render(makeState());
    expect(output).toContain("╔");
    expect(output).toContain("╚");
    expect(output).toContain("║");
    expect(output).toContain("╠");
  });

  it("renders selector item with focus indicator", () => {
    render(makeState({
      items: [
        { type: "selector", label: "Run scrape", focused: true },
        { type: "selector", label: "Cancel",     focused: false },
      ],
    }));
    expect(output).toContain("> Run scrape");
    expect(output).toContain("  Cancel");
  });

  it("renders toggle item with checked state", () => {
    render(makeState({
      items: [
        { type: "toggle", label: "Verbose", checked: true,  focused: true  },
        { type: "toggle", label: "Quiet",   checked: false, focused: false },
      ],
    }));
    expect(output).toContain("[x] Verbose");
    expect(output).toContain("[ ] Quiet");
  });

  it("renders radio item with selected state", () => {
    render(makeState({
      items: [
        { type: "radio", label: "Normal",  selected: true,  focused: true  },
        { type: "radio", label: "Force",   selected: false, focused: false },
      ],
    }));
    expect(output).toContain("(•) Normal");
    expect(output).toContain("( ) Force");
  });

  it("renders command item with arrow prefix", () => {
    render(makeState({
      items: [{ type: "command", cmd: "msc scrape --force" }],
    }));
    expect(output).toContain("↳ msc scrape --force");
  });

  it("uses custom footer when provided", () => {
    render(makeState({ footer: "Enter confirm  q back" }));
    expect(output).toContain("Enter confirm  q back");
  });

  it("appends page indicator when totalPages > 1", () => {
    render(makeState({ page: 2, totalPages: 3 }));
    expect(output).toContain("[2/3]");
  });

  it("does NOT append page indicator when totalPages is 1", () => {
    render(makeState({ page: 1, totalPages: 1 }));
    expect(output).not.toContain("[1/1]");
  });

  it("truncates long labels with ellipsis", () => {
    const longLabel = "A".repeat(200);
    render(makeState({ items: [{ type: "text", content: longLabel }] }));
    expect(output).toContain("…");
  });
});

// ─── options-registry ────────────────────────────────────────────────────────

describe("SCRAPE_BOOL_OPTIONS", () => {
  it("has at least verbose, quiet, skipDiskCheck, metadata", () => {
    const keys = SCRAPE_BOOL_OPTIONS.map((o) => o.key);
    expect(keys).toContain("verbose");
    expect(keys).toContain("quiet");
    expect(keys).toContain("skipDiskCheck");
    expect(keys).toContain("metadata");
  });

  it("verbose and quiet are mutually exclusive", () => {
    const verbose = SCRAPE_BOOL_OPTIONS.find((o) => o.key === "verbose");
    const quiet   = SCRAPE_BOOL_OPTIONS.find((o) => o.key === "quiet");
    expect(verbose?.mutuallyExclusive).toContain("quiet");
    expect(quiet?.mutuallyExclusive).toContain("verbose");
  });

  it("all options have boolean defaults", () => {
    for (const opt of SCRAPE_BOOL_OPTIONS) {
      expect(typeof opt.default).toBe("boolean");
    }
  });

  it("all options have non-empty labels", () => {
    for (const opt of SCRAPE_BOOL_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });

  it("does not default any option to true", () => {
    // All toggles start off (user explicitly enables)
    for (const opt of SCRAPE_BOOL_OPTIONS) {
      expect(opt.default).toBe(false);
    }
  });
});

// ─── T-18: CONFIG_DESCRIPTIONS coverage ──────────────────────────────────────

import { CONFIG_DESCRIPTIONS } from "../../src/config.js";

describe("T-18: CONFIG_DESCRIPTIONS", () => {
  it("has a description for every USER_EDITABLE_KEY", () => {
    for (const key of USER_EDITABLE_KEYS) {
      expect(CONFIG_DESCRIPTIONS).toHaveProperty(key);
      expect(typeof CONFIG_DESCRIPTIONS[key]).toBe("string");
      expect((CONFIG_DESCRIPTIONS[key] as string).length).toBeGreaterThan(0);
    }
  });

  it("outputDir description mentions 'folder' or 'directory'", () => {
    const desc = CONFIG_DESCRIPTIONS.outputDir ?? "";
    expect(desc.toLowerCase()).toMatch(/folder|directory/);
  });

  it("maxConcurrentDownloads description mentions 'parallel' or 'concurrent'", () => {
    const desc = CONFIG_DESCRIPTIONS.maxConcurrentDownloads ?? "";
    expect(desc.toLowerCase()).toMatch(/parallel|concurrent/);
  });

  it("descriptions are short enough to fit in a terminal line (under 80 chars)", () => {
    for (const [key, desc] of Object.entries(CONFIG_DESCRIPTIONS)) {
      expect((desc ?? "").length).toBeLessThanOrEqual(80);
    }
  });
});

// ─── USER_EDITABLE_KEYS ──────────────────────────────────────────────────────

describe("USER_EDITABLE_KEYS", () => {
  it("does not contain logHintShown (internal flag)", () => {
    expect(USER_EDITABLE_KEYS).not.toContain("logHintShown");
  });

  it("contains checkUpdates (user-configurable)", () => {
    expect(USER_EDITABLE_KEYS).toContain("checkUpdates");
  });

  it("contains core keys: outputDir, maxConcurrentDownloads, requestDelayMs", () => {
    expect(USER_EDITABLE_KEYS).toContain("outputDir");
    expect(USER_EDITABLE_KEYS).toContain("maxConcurrentDownloads");
    expect(USER_EDITABLE_KEYS).toContain("requestDelayMs");
  });

  it("has at least 8 keys", () => {
    expect(USER_EDITABLE_KEYS.length).toBeGreaterThanOrEqual(8);
  });
});
