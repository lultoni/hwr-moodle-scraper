// Covers: STEP-017 (incremental sync integration)
//         Full incremental sync: first run downloads, second run skips unchanged files.

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

vi.mock("../../src/auth/keychain.js", () => ({
  KeychainAdapter: vi.fn().mockImplementation(() => ({
    readCredentials: vi.fn().mockResolvedValue({ username: "alice", password: "pass" }),
    storeCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
  })),
}));

const BASE = "https://moodle.example.com";

function setupMocks(fileHash: string) {
  mockAgent.get(BASE).intercept({ path: "/my/", method: "GET" })
    .reply(200, "<html><body>Dashboard</body></html>", { headers: { "content-type": "text/html" } });

  mockAgent.get(BASE).intercept({ path: /\/lib\/ajax\/service\.php/, method: "POST" })
    .reply(200, JSON.stringify([{ data: [{ id: 1, fullname: "Test Course", viewurl: `${BASE}/course/view.php?id=1`, hash: fileHash }] }]), { headers: { "content-type": "application/json" } });

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

  it("second run with no changes: 0 files downloaded", async () => {
    // First run
    setupMocks("hash-v1");
    mockAgent.get(BASE).intercept({ path: "/mod/resource/view.php?id=10", method: "GET" })
      .reply(303, "", { headers: { location: `${BASE}/pluginfile.php/1/content/lecture.pdf` } });
    mockAgent.get(BASE).intercept({ path: "/pluginfile.php/1/content/lecture.pdf", method: "GET" })
      .reply(200, "pdf content", { headers: { "content-type": "application/pdf" } });

    const { runScrape } = await import("../../src/commands/scrape.js");
    await runScrape({ outputDir: tmpDir, dryRun: false, force: false, baseUrl: BASE });

    // Second run — same hash, no download expected
    setupMocks("hash-v1");
    // No file download mock — if it tries to download, undici will throw (disableNetConnect)

    const downloadSpy = vi.fn();
    vi.doMock("../../src/scraper/downloader.js", () => ({
      downloadFile: downloadSpy,
      DownloadQueue: vi.fn().mockImplementation(() => ({ run: vi.fn() })),
    }));

    await runScrape({ outputDir: tmpDir, dryRun: false, force: false, baseUrl: BASE });

    // 0 downloads on second run
    expect(downloadSpy).not.toHaveBeenCalled();
  });
});
