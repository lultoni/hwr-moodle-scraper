// Covers: STEP-015, REQ-SCRAPE-005, REQ-SCRAPE-006, REQ-SCRAPE-007, REQ-SCRAPE-008
//
// Tests for non-file content type handlers: external URLs, assignments,
// forums/announcements, and inline labels.
// Uses temp dirs; no real HTTP.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeUrlFile,
  writeAssignmentDescription,
  writeForumPost,
  appendLabelContent,
  writeWeblocFile,
  writeWindowsUrlFile,
} from "../../src/scraper/content-types.js";
import { createTurndown } from "../../src/scraper/turndown.js";

describe("STEP-015: External URL handler", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "msc-ct-test-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  // REQ-SCRAPE-005
  it("writes a .url.txt file with the URL on the first line", async () => {
    const dest = join(tmpDir, "Moodle Docs.url.txt");
    await writeUrlFile(dest, "https://docs.moodle.org");
    const content = readFileSync(dest, "utf8");
    expect(content.split("\n")[0]).toBe("https://docs.moodle.org");
  });

  it("writes URL file with name header and description when provided", async () => {
    const dest = join(tmpDir, "Die Betriebssysteme.url.txt");
    await writeUrlFile(dest, "https://example.com/history", {
      name: "Die Betriebssysteme im Laufe der Zeit",
      description: "<p>Eine Übersicht der Betriebssystem-Geschichte</p>",
    });
    const content = readFileSync(dest, "utf8");
    expect(content).toContain("# Die Betriebssysteme im Laufe der Zeit");
    expect(content).toContain("https://example.com/history");
    expect(content).toContain("Betriebssystem-Geschichte");
    expect(content).not.toContain("<p>");
  });

  it("file extension is .url.txt", async () => {
    const dest = join(tmpDir, "Example.url.txt");
    await writeUrlFile(dest, "https://example.com");
    expect(existsSync(dest)).toBe(true);
  });
});

describe("STEP-015: Assignment description handler", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "msc-assign-test-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  // REQ-SCRAPE-006
  it("writes _description.md with title, due date, description, submission type", async () => {
    const dest = join(tmpDir, "Essay 1_description.md");
    await writeAssignmentDescription(dest, {
      title: "Essay 1",
      dueDate: "2026-04-01T23:59:00.000Z",
      description: "<p>Write about macroeconomics.</p>",
      submissionType: "Online text",
    });
    const content = readFileSync(dest, "utf8");
    expect(content).toContain("Essay 1");
    expect(content).toContain("2026-04-01");
    expect(content).toContain("macroeconomics");
    expect(content).toContain("Online text");
    expect(content).not.toContain("<p>"); // HTML must be converted to Markdown
  });

  it("writes 'No due date' when dueDate is null", async () => {
    const dest = join(tmpDir, "Assignment_description.md");
    await writeAssignmentDescription(dest, {
      title: "Assignment",
      dueDate: null,
      description: "Do something.",
      submissionType: "File submission",
    });
    const content = readFileSync(dest, "utf8");
    expect(content).toContain("No due date");
  });
});

describe("STEP-015: Forum post handler", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "msc-forum-test-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  // REQ-SCRAPE-007
  it("writes <postTitle>.md with front-matter: author, timestamp, subject", async () => {
    const dest = join(tmpDir, "Welcome.md");
    await writeForumPost(dest, {
      title: "Welcome",
      author: "Prof. Müller",
      timestamp: "2026-03-01T08:00:00.000Z",
      body: "<p>Welcome to the course!</p>",
    });
    const content = readFileSync(dest, "utf8");
    expect(content).toContain("author:");
    expect(content).toContain("Prof. Müller");
    expect(content).toContain("2026-03-01");
    expect(content).toContain("Welcome to the course!");
    expect(content).not.toContain("<p>"); // HTML converted
  });
});

describe("STEP-015: Inline label handler", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "msc-label-test-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  // REQ-SCRAPE-008
  it("appends label content to _labels.md in section order", async () => {
    const labelsFile = join(tmpDir, "_labels.md");
    await appendLabelContent(labelsFile, "<p>First label text.</p>");
    await appendLabelContent(labelsFile, "<p>Second label text.</p>");
    const content = readFileSync(labelsFile, "utf8");
    expect(content).toContain("First label text.");
    expect(content).toContain("Second label text.");
    // First label appears before second
    expect(content.indexOf("First")).toBeLessThan(content.indexOf("Second"));
    expect(content).not.toContain("<p>"); // HTML converted
  });
});

describe("GFM table support via createTurndown", () => {
  it("converts HTML table to markdown table with pipes", () => {
    const td = createTurndown();
    const html = `<table>
      <thead><tr><th>Period</th><th>Hours</th></tr></thead>
      <tbody><tr><td>Monday</td><td>10-18</td></tr><tr><td>Friday</td><td>10-17</td></tr></tbody>
    </table>`;
    const md = td.turndown(html);
    expect(md).toContain("|");
    expect(md).toContain("Period");
    expect(md).toContain("Hours");
    expect(md).toContain("Monday");
    expect(md).toContain("10-18");
  });

  it("preserves strikethrough in GFM mode", () => {
    const td = createTurndown();
    const html = "<p>This is <s>wrong</s> correct.</p>";
    const md = td.turndown(html);
    expect(md).toContain("~wrong~");
  });
});

// UC-05: native URL shortcut files
describe("UC-05: platform-native URL shortcut files", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "msc-url-test-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("writeWeblocFile writes valid XML plist with the URL", () => {
    const dest = join(tmpDir, "link.webloc");
    writeWeblocFile(dest, "https://example.com/page");
    const content = readFileSync(dest, "utf8");
    expect(content).toContain("<?xml");
    expect(content).toContain("<plist");
    expect(content).toContain("https://example.com/page");
  });

  it("writeWeblocFile escapes URL entities in XML", () => {
    const dest = join(tmpDir, "link.webloc");
    writeWeblocFile(dest, "https://example.com/page?a=1&b=2");
    const content = readFileSync(dest, "utf8");
    expect(content).toContain("&amp;");
    expect(content).not.toContain("&b=");
  });

  it("writeWindowsUrlFile writes INI format with the URL", () => {
    const dest = join(tmpDir, "link.url");
    writeWindowsUrlFile(dest, "https://example.com/win");
    const content = readFileSync(dest, "utf8");
    expect(content).toContain("[InternetShortcut]");
    expect(content).toContain("URL=https://example.com/win");
  });
});
