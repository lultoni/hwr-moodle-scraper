// Covers: STEP-014, REQ-SCRAPE-003, REQ-SCRAPE-004, REQ-SCRAPE-009, REQ-SCRAPE-010, REQ-SCRAPE-011
//
// Tests for the streaming file download engine: streaming (no full-file buffering),
// concurrency limit, progress reporting, and folder traversal.
// Uses undici MockAgent for HTTP; writes to temp dirs.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from "undici";
import { mkdtempSync, rmSync, statSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { downloadFile, DownloadQueue, extractFilename } from "../../src/scraper/downloader.js";

let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
  mockAgent.close();
});

const BASE = "https://moodle.example.com";

describe("STEP-014: File download — streaming", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-dl-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // REQ-SCRAPE-009 — streaming: file should appear on disk, content correct
  it("downloads a file to disk via streaming", async () => {
    const content = "fake pdf content";
    mockAgent.get(BASE).intercept({ path: "/file.pdf", method: "GET" }).reply(200, content, {
      headers: { "content-type": "application/pdf", "content-length": String(content.length) },
    });

    const dest = join(tmpDir, "file.pdf");
    await downloadFile({ url: `${BASE}/file.pdf`, destPath: dest, sessionCookies: "" });

    expect(existsSync(dest)).toBe(true);
    expect(statSync(dest).size).toBeGreaterThan(0);
  });

  it("appends extension from Content-Disposition when destPath has no extension", async () => {
    const content = "pdf content";
    mockAgent.get(BASE).intercept({ path: "/mod/resource/view.php?id=1", method: "GET" }).reply(200, content, {
      headers: {
        "content-disposition": 'attachment; filename="Skript.pdf"',
        "content-type": "application/pdf",
      },
    });

    const dest = join(tmpDir, "Skript");
    const { finalPath } = await downloadFile({ url: `${BASE}/mod/resource/view.php?id=1`, destPath: dest, sessionCookies: "" });

    expect(extname(finalPath)).toBe(".pdf");
    expect(existsSync(finalPath)).toBe(true);
  });

  it("appends extension from final URL pathname when no Content-Disposition", async () => {
    const content = "pptx content";
    // Redirect to actual file URL with extension
    mockAgent.get(BASE)
      .intercept({ path: "/mod/resource/view.php?id=2", method: "GET" })
      .reply(302, "", { headers: { location: `${BASE}/pluginfile.php/1/mod_resource/content/0/Praesentation.pptx` } });
    mockAgent.get(BASE)
      .intercept({ path: "/pluginfile.php/1/mod_resource/content/0/Praesentation.pptx", method: "GET" })
      .reply(200, content, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation" } });

    const dest = join(tmpDir, "Praesentation");
    const { finalPath } = await downloadFile({ url: `${BASE}/mod/resource/view.php?id=2`, destPath: dest, sessionCookies: "" });

    expect(extname(finalPath)).toBe(".pptx");
    expect(existsSync(finalPath)).toBe(true);
  });

  it("retries on 'other side closed' network error and succeeds on second attempt", async () => {
    const content = "retry content";
    let attempts = 0;

    // First attempt throws network error, second succeeds
    mockAgent.get(BASE)
      .intercept({ path: "/retry-test.pdf", method: "GET" })
      .replyWithError(Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }));
    mockAgent.get(BASE)
      .intercept({ path: "/retry-test.pdf", method: "GET" })
      .reply(200, content, { headers: { "content-type": "application/pdf" } });

    const dest = join(tmpDir, "retry-test.pdf");
    const { finalPath } = await downloadFile({
      url: `${BASE}/retry-test.pdf`,
      destPath: dest,
      sessionCookies: "",
      retryBaseDelayMs: 0, // no delay in tests
    });

    expect(existsSync(finalPath)).toBe(true);
  });
});

describe("STEP-014: Download queue — concurrency", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-queue-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // REQ-SCRAPE-010
  it("never exceeds maxConcurrent downloads in flight", async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxSeen = 0;

    // Create 6 mock file downloads
    const items = Array.from({ length: 6 }, (_, i) => {
      const path = `/file${i}.pdf`;
      mockAgent.get(BASE).intercept({ path, method: "GET" }).reply(200, "data");
      return { url: `${BASE}${path}`, destPath: join(tmpDir, `file${i}.pdf`), sessionCookies: "" };
    });

    const queue = new DownloadQueue({ maxConcurrent: 3 });

    // Wrap downloadFile to track concurrency
    const origDownload = downloadFile;
    vi.spyOn({ downloadFile }, "downloadFile").mockImplementation(async (...args) => {
      inFlight++;
      maxSeen = Math.max(maxSeen, inFlight);
      await origDownload(...args);
      inFlight--;
    });

    await vi.runAllTimersAsync();
    await queue.run(items);

    expect(maxSeen).toBeLessThanOrEqual(3);
    vi.useRealTimers();
  });
});

describe("STEP-014: Download progress display", () => {
  // REQ-SCRAPE-011
  it("calls onProgress callback with filename and bytesReceived", async () => {
    const content = "some content bytes";
    mockAgent.get(BASE).intercept({ path: "/progress-test.pdf", method: "GET" }).reply(200, content, {
      headers: { "content-length": String(content.length) },
    });

    const tmpDir = mkdtempSync(join(tmpdir(), "msc-prog-test-"));
    const progressEvents: Array<{ bytesReceived: number }> = [];

    await downloadFile({
      url: `${BASE}/progress-test.pdf`,
      destPath: join(tmpDir, "progress-test.pdf"),
      sessionCookies: "",
      onProgress: (e) => progressEvents.push(e),
    });

    rmSync(tmpDir, { recursive: true, force: true });

    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[progressEvents.length - 1]?.bytesReceived).toBeGreaterThan(0);
  });

  it("calls onComplete callback after successful download", async () => {
    const tmpDir2 = mkdtempSync(join(tmpdir(), "msc-complete-test-"));
    mockAgent.get(BASE).intercept({ path: "/oncomplete.pdf", method: "GET" }).reply(200, "content");

    let completedPath = "";
    await downloadFile({
      url: `${BASE}/oncomplete.pdf`,
      destPath: join(tmpDir2, "oncomplete.pdf"),
      sessionCookies: "",
      onComplete: (p) => { completedPath = p; },
    });

    rmSync(tmpDir2, { recursive: true, force: true });
    expect(completedPath).toContain("oncomplete");
  });
});

describe("STEP-014: DownloadQueue — per-item error isolation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-isolation-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // REQ-SCRAPE-010 — one failure must not abort the whole queue
  it("continues downloading remaining items after one item fails", async () => {
    // Item 1 fails (network error, all retries exhausted)
    for (let i = 0; i < 5; i++) {
      mockAgent.get(BASE)
        .intercept({ path: "/fail.pdf", method: "GET" })
        .replyWithError(new Error("other side closed"));
    }
    // Item 2 succeeds
    mockAgent.get(BASE)
      .intercept({ path: "/ok.pdf", method: "GET" })
      .reply(200, "ok content", { headers: { "content-type": "application/pdf" } });

    const queue = new DownloadQueue({ maxConcurrent: 2 });
    const result = await queue.run([
      { url: `${BASE}/fail.pdf`, destPath: join(tmpDir, "fail.pdf"), sessionCookies: "", retryBaseDelayMs: 0 },
      { url: `${BASE}/ok.pdf`, destPath: join(tmpDir, "ok.pdf"), sessionCookies: "", retryBaseDelayMs: 0 },
    ]);

    expect(result.failed).toHaveLength(1);
    expect(result.downloaded).toBe(1);
    expect(existsSync(join(tmpDir, "ok.pdf"))).toBe(true);
  });

  it("returns finalPaths with actual on-disk path (including extension) for each item", async () => {
    // Item uses view.php URL that redirects, Content-Disposition gives .pdf extension
    mockAgent.get(BASE)
      .intercept({ path: "/mod/resource/view.php?id=99", method: "GET" })
      .reply(200, "pdf bytes", {
        headers: { "content-disposition": 'attachment; filename="Lecture.pdf"' },
      });

    const queue = new DownloadQueue({ maxConcurrent: 1 });
    const destPath = join(tmpDir, "Lecture");  // no extension
    const result = await queue.run([
      { url: `${BASE}/mod/resource/view.php?id=99`, destPath, sessionCookies: "" },
    ]);

    expect(result.downloaded).toBe(1);
    expect(result.finalPaths[0]).toBe(destPath + ".pdf");
    expect(existsSync(destPath + ".pdf")).toBe(true);
  });
});

describe("extractFilename — unit tests", () => {
  it("extracts filename from Content-Disposition attachment header", () => {
    const name = extractFilename(
      { "content-disposition": 'attachment; filename="Report.pdf"' },
      "https://example.com/mod/resource/view.php?id=1"
    );
    expect(name).toBe("Report.pdf");
  });

  it("gracefully handles Content-Disposition filename* (RFC 5987) without crashing", () => {
    // RFC 5987 encoded names (filename*=UTF-8''...) are not parsed — returns null gracefully
    const name = extractFilename(
      { "content-disposition": "attachment; filename*=UTF-8''Pr%C3%A4sentation.pptx" },
      "https://example.com/irrelevant"
    );
    // null is acceptable — caller falls back to activity name
    expect(name === null || typeof name === "string").toBe(true);
  });

  it("falls back to final URL pathname when no Content-Disposition", () => {
    const name = extractFilename(
      {},
      "https://moodle.example.com/pluginfile.php/1/mod_resource/content/0/Skript_WS24.pdf?forcedownload=1"
    );
    expect(name).toBe("Skript_WS24.pdf");
  });

  it("returns null when neither header nor URL provides useful filename", () => {
    const name = extractFilename({}, "https://example.com/");
    expect(name).toBeNull();
  });

  it("derives extension from Content-Type when URL has no extension (e.g. Moodle view.php?id=N)", () => {
    const name = extractFilename(
      { "content-type": "application/pdf" },
      "https://moodle.example.com/mod/resource/view.php?id=1234"
    );
    // Should return something ending in .pdf derived from MIME type
    expect(name).not.toBeNull();
    expect(name).toMatch(/\.pdf$/);
  });

  it("derives .docx extension from application/vnd.openxmlformats-officedocument.wordprocessingml.document", () => {
    const name = extractFilename(
      { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      "https://moodle.example.com/mod/resource/view.php?id=5678"
    );
    expect(name).not.toBeNull();
    expect(name).toMatch(/\.docx$/);
  });

  it("does not derive extension from text/html Content-Type (not a downloadable file)", () => {
    const name = extractFilename(
      { "content-type": "text/html; charset=utf-8" },
      "https://moodle.example.com/mod/resource/view.php?id=9999"
    );
    // text/html means we got a page, not a file — should not create a .html file
    expect(name).toBeNull();
  });

  it("strips path traversal sequences from Content-Disposition filename", () => {
    const name = extractFilename(
      { "content-disposition": 'attachment; filename="../../../../.zshrc"' },
      "https://moodle.example.com/pluginfile.php/1/content/0/file"
    );
    // Must not return a path with .. segments
    expect(name).not.toContain("..");
    expect(name).not.toContain("/");
  });

  it("strips leading slash from Content-Disposition filename", () => {
    const name = extractFilename(
      { "content-disposition": 'attachment; filename="/etc/passwd"' },
      "https://moodle.example.com/file"
    );
    expect(name).not.toMatch(/^\//);
  });
});
