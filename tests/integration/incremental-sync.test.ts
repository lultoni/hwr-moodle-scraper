// @vitest-pool forks
// Covers: STEP-017 (incremental sync integration)
//         Full incremental sync: first run downloads, second run skips unchanged files.
// Runs in a forked process to prevent setGlobalDispatcher races with parallel unit tests.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from "undici";

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

vi.mock("../../src/auth/keychain.js", () => {
  const mockKeychain = {
    readCredentials: vi.fn().mockResolvedValue({ username: "alice", password: "pass" }),
    storeCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
  };
  return {
    KeychainAdapter: vi.fn().mockImplementation(() => mockKeychain),
    tryCreateKeychain: vi.fn(() => mockKeychain),
    tryCreateCredentialStore: vi.fn(() => mockKeychain),
  };
});

const BASE = "https://moodle.example.com";

function setupMocks(fileHash: string) {
  // Session validation: GET /my/
  mockAgent.get(BASE).intercept({ path: "/my/", method: "GET" })
    .reply(200, "<html><body>Dashboard</body></html>", { headers: { "content-type": "text/html" } });

  // fetchEnrolledCourses: GET /my/ (second hit — no sesskey → falls back to /my/courses.php)
  mockAgent.get(BASE).intercept({ path: "/my/", method: "GET" })
    .reply(200, "<html><body>Dashboard</body></html>", { headers: { "content-type": "text/html" } });
  mockAgent.get(BASE).intercept({ path: /\/my\/courses\.php/, method: "GET" })
    .reply(200, "<html><body></body></html>", { headers: { "content-type": "text/html" } });

  mockAgent.get(BASE).intercept({ path: "/course/view.php?id=1", method: "GET" })
    .reply(200, `
      <html><body>
        <li class="section"><h3 class="sectionname">Week 1</h3>
          <ul class="section">
            <li class="activity resource" data-resource-id="r1" data-hash="${fileHash}">
              <a href="${BASE}/mod/resource/view.php?id=10">Lecture PDF</a>
            </li>
          </ul>
        </li>
      </body></html>
    `, { headers: { "content-type": "text/html" } });
}

describe("Integration: incremental sync", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-sync-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("second run with no changes: 0 files downloaded", { timeout: 15000 }, async () => {
    // First run
    setupMocks("hash-v1");
    mockAgent.get(BASE).intercept({ path: "/mod/resource/view.php?id=10", method: "GET" })
      .reply(303, "", { headers: { location: `${BASE}/pluginfile.php/1/content/lecture.pdf` } });
    mockAgent.get(BASE).intercept({ path: "/pluginfile.php/1/content/lecture.pdf", method: "GET" })
      .reply(200, "pdf content", { headers: { "content-type": "application/pdf" } });

    const { runScrape } = await import("../../src/commands/scrape.js");
    await runScrape({ outputDir: tmpDir, dryRun: false, force: false, baseUrl: BASE, courses: [1] });

    // Second run — same hash, no download expected
    setupMocks("hash-v1");
    // No file download mock — if it tries to download, undici will throw (disableNetConnect)

    const downloadSpy = vi.fn();
    vi.doMock("../../src/scraper/downloader.js", () => ({
      downloadFile: downloadSpy,
      DownloadQueue: vi.fn().mockImplementation(() => ({ run: vi.fn() })),
    }));

    await runScrape({ outputDir: tmpDir, dryRun: false, force: false, baseUrl: BASE, courses: [1] });

    // 0 downloads on second run
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it("assign activities are acknowledged in state and not re-planned on second run", { timeout: 15000 }, async () => {
    // Course page with an assign activity (non-downloadable) + a resource
    const courseHtml = `
      <html><body>
        <li class="section"><h3 class="sectionname">Week 1</h3>
          <ul class="section">
            <li class="activity assign modtype_assign" data-resource-id="assign-1">
              <a href="${BASE}/mod/assign/view.php?id=20">Assignment 1</a>
            </li>
            <li class="activity resource modtype_resource" data-resource-id="res-1">
              <a href="${BASE}/mod/resource/view.php?id=10">Lecture PDF</a>
            </li>
          </ul>
        </li>
      </body></html>
    `;

    // First run
    mockAgent.get(BASE).intercept({ path: "/my/", method: "GET" })
      .reply(200, "<html><body>Dashboard</body></html>", { headers: { "content-type": "text/html" } });
    // fetchEnrolledCourses second /my/ hit + fallback
    mockAgent.get(BASE).intercept({ path: "/my/", method: "GET" })
      .reply(200, "<html><body>Dashboard</body></html>", { headers: { "content-type": "text/html" } });
    mockAgent.get(BASE).intercept({ path: /\/my\/courses\.php/, method: "GET" })
      .reply(200, "<html><body></body></html>", { headers: { "content-type": "text/html" } });
    mockAgent.get(BASE).intercept({ path: "/course/view.php?id=1", method: "GET" })
      .reply(200, courseHtml, { headers: { "content-type": "text/html" } });
    mockAgent.get(BASE).intercept({ path: "/mod/resource/view.php?id=10", method: "GET" })
      .reply(303, "", { headers: { location: `${BASE}/pluginfile.php/1/content/lecture.pdf` } });
    mockAgent.get(BASE).intercept({ path: "/pluginfile.php/1/content/lecture.pdf", method: "GET" })
      .reply(200, "pdf content", { headers: { "content-type": "application/pdf" } });

    const { runScrape } = await import("../../src/commands/scrape.js");
    await runScrape({ outputDir: tmpDir, dryRun: false, force: false, baseUrl: BASE, courses: [1] });

    // State must contain both the assign activity AND the resource
    const state1 = JSON.parse(readFileSync(join(tmpDir, ".moodle-scraper-state.json"), "utf8"));
    const course1 = Object.values(state1.courses)[0] as { sections: Record<string, { files: Record<string, unknown> }> };
    const allResourceIds1 = Object.values(course1.sections).flatMap((s) => Object.keys(s.files));
    expect(allResourceIds1).toContain("assign-1");
    expect(allResourceIds1).toContain("res-1");

    // Second run — assign and resource should both be SKIP
    mockAgent.get(BASE).intercept({ path: "/my/", method: "GET" })
      .reply(200, "<html><body>Dashboard</body></html>", { headers: { "content-type": "text/html" } });
    // fetchEnrolledCourses second /my/ hit + fallback
    mockAgent.get(BASE).intercept({ path: "/my/", method: "GET" })
      .reply(200, "<html><body>Dashboard</body></html>", { headers: { "content-type": "text/html" } });
    mockAgent.get(BASE).intercept({ path: /\/my\/courses\.php/, method: "GET" })
      .reply(200, "<html><body></body></html>", { headers: { "content-type": "text/html" } });
    mockAgent.get(BASE).intercept({ path: "/course/view.php?id=1", method: "GET" })
      .reply(200, courseHtml, { headers: { "content-type": "text/html" } });
    // No download mocks — any download attempt will throw (disableNetConnect)

    await runScrape({ outputDir: tmpDir, dryRun: false, force: false, baseUrl: BASE, courses: [1] });

    // State still has both items after second run
    const state2 = JSON.parse(readFileSync(join(tmpDir, ".moodle-scraper-state.json"), "utf8"));
    const course2 = Object.values(state2.courses)[0] as { sections: Record<string, { files: Record<string, unknown> }> };
    const allResourceIds2 = Object.values(course2.sections).flatMap((s) => Object.keys(s.files));
    expect(allResourceIds2).toContain("assign-1");
    expect(allResourceIds2).toContain("res-1");
  });
});
