// UC-20: msc help <topic>

import { describe, it, expect, vi, afterEach } from "vitest";
import { runHelp, HELP_TOPICS } from "../../src/commands/help.js";

describe("runHelp — no topic", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints usage and lists available topics", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp();
    const text = out.join("");
    expect(text).toContain("Usage: msc help <topic>");
    expect(text).toContain("Available topics:");
    // at least a few known topics listed
    expect(text).toContain("orphaned");
    expect(text).toContain("user-files");
    expect(text).toContain("reset");
  });

  it("shows old-entries alias", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp();
    const text = out.join("");
    expect(text).toContain("old-entries");
  });
});

describe("runHelp — known topics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints content for 'orphaned'", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("orphaned");
    const text = out.join("");
    expect(text.length).toBeGreaterThan(50);
    expect(text).toContain("ended");
  });

  it("prints same content for 'old-entries' alias", () => {
    const orphanedOut: string[] = [];
    const oldEntriesOut: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { orphanedOut.push(String(s)); return true; });
    runHelp("orphaned");
    vi.restoreAllMocks();
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { oldEntriesOut.push(String(s)); return true; });
    runHelp("old-entries");
    expect(orphanedOut.join("")).toBe(oldEntriesOut.join(""));
  });

  it("prints content for 'user-files'", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("user-files");
    const text = out.join("");
    expect(text).toContain("msc clean");
    expect(text).toContain("_User-Files");
  });

  it("prints content for 'state'", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("state");
    const text = out.join("");
    expect(text).toContain("state");
    expect(text).toContain("moodle-scraper-state.json");
  });

  it("prints content for 'reset'", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("reset");
    const text = out.join("");
    expect(text).toContain("msc reset");
    expect(text).toContain("--full");
  });

  it("prints content for 'clean'", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("clean");
    const text = out.join("");
    expect(text).toContain("msc clean");
    expect(text).toContain("--move");
  });

  it("prints content for 'sidecar'", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("sidecar");
    const text = out.join("");
    expect(text).toContain(".description.md");
  });

  it("prints content for 'sync'", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("sync");
    const text = out.join("");
    expect(text).toContain("Incremental");
  });

  it("topic matching is case-insensitive", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("RESET");
    const text = out.join("");
    expect(text).toContain("msc reset");
  });
});

describe("runHelp — unknown topic", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints 'Unknown topic' and lists available topics", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("nonexistent-topic");
    const text = out.join("");
    expect(text).toContain('Unknown topic: "nonexistent-topic"');
    expect(text).toContain("Available topics:");
  });
});

describe("HELP_TOPICS export", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(HELP_TOPICS)).toBe(true);
    expect(HELP_TOPICS.length).toBeGreaterThan(0);
  });

  it("does not contain 'old-entries' alias", () => {
    expect(HELP_TOPICS).not.toContain("old-entries");
  });

  it("contains 'archive' and 'config'", () => {
    expect(HELP_TOPICS).toContain("archive");
    expect(HELP_TOPICS).toContain("config");
  });
});

describe("runHelp — new and updated topics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("'archive' topic prints archive text", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("archive");
    const text = out.join("");
    expect(text).toContain("msc archive");
    expect(text).toContain("--courses");
    expect(text).toContain("--dry-run");
  });

  it("'config' topic prints config text", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("config");
    const text = out.join("");
    expect(text).toContain("msc config list");
    expect(text).toContain("outputDir");
    expect(text).toContain("postScrapeHook");
  });

  it("'update' topic uses npm install not npm ci", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("update");
    const text = out.join("");
    expect(text).toContain("npm install");
    expect(text).not.toContain("npm ci");
  });

  it("'sync' topic mentions --force and --check-files", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("sync");
    const text = out.join("");
    expect(text).toContain("--force");
    expect(text).toContain("--check-files");
  });

  it("'sidecar' topic mentions --no-descriptions", () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    runHelp("sidecar");
    const text = out.join("");
    expect(text).toContain("--no-descriptions");
  });
});
