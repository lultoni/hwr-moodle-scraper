// Covers: STEP-020 (pipeline integration), REQ-CLI-002
//         Full end-to-end scrape pipeline with mocked HTTP and real temp filesystem.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
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

describe("Integration: full scrape pipeline", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-integration-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full scrape: session check → course list → tree → download → state file", async () => {
    const pdfContent = "fake pdf bytes";

    // Session validation: GET /my/ → not login page
    mockAgent.get(BASE).intercept({ path: "/my/", method: "GET" })
      .reply(200, "<html><body>Dashboard</body></html>", { headers: { "content-type": "text/html" } });

    // Course list via search page
    mockAgent.get(BASE).intercept({ path: /\/course\/search\.php/, method: "GET" })
      .reply(200, `
        <div class="coursebox" data-courseid="1" data-type="1">
          <div class="info"><h3 class="coursename">
            <a class="aalink" href="${BASE}/course/view.php?id=1">Test Course</a>
          </h3></div>
        </div>
      `, { headers: { "content-type": "text/html" } });

    // Course content tree
    mockAgent.get(BASE).intercept({ path: "/course/view.php?id=1", method: "GET" })
      .reply(200, `
        <html><body>
          <li class="section"><h3 class="sectionname">Week 1</h3>
            <ul class="section">
              <li class="activity resource modtype_resource">
                <a href="${BASE}/mod/resource/view.php?id=10">Lecture PDF</a>
              </li>
            </ul>
          </li>
        </body></html>
      `, { headers: { "content-type": "text/html" } });

    // Resource redirect to file
    mockAgent.get(BASE).intercept({ path: "/mod/resource/view.php?id=10", method: "GET" })
      .reply(303, "", { headers: { location: `${BASE}/pluginfile.php/1/content/lecture.pdf` } });

    // Actual file download
    mockAgent.get(BASE).intercept({ path: "/pluginfile.php/1/content/lecture.pdf", method: "GET" })
      .reply(200, pdfContent, { headers: { "content-type": "application/pdf", "content-length": String(pdfContent.length) } });

    const { runScrape } = await import("../../src/commands/scrape.js");
    await runScrape({ outputDir: tmpDir, dryRun: false, force: false, baseUrl: BASE, courses: [1] });

    // State file must exist
    expect(existsSync(join(tmpDir, ".moodle-scraper-state.json"))).toBe(true);
  });
});
