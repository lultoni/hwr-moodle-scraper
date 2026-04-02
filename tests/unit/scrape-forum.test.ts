// Tests for forum thread URL extraction and deep-dive fetching.
// src/scraper/forum.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from "undici";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractForumThreadUrls } from "../../src/scraper/forum.js";

const BASE = "https://moodle.example.com";

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

describe("extractForumThreadUrls — unit tests", () => {
  it("extracts discuss.php thread links from forum index HTML", () => {
    const html = `<html><body>
      <table class="forumheaderlist">
        <tr class="discussion">
          <td class="topic"><a href="${BASE}/mod/forum/discuss.php?d=1001">Ankündigung 1</a></td>
        </tr>
        <tr class="discussion">
          <td class="topic"><a href="${BASE}/mod/forum/discuss.php?d=1002">Ankündigung 2</a></td>
        </tr>
      </table>
    </body></html>`;
    const threads = extractForumThreadUrls(html, BASE);
    expect(threads).toHaveLength(2);
    expect(threads[0]).toMatchObject({ title: "Ankündigung 1", url: `${BASE}/mod/forum/discuss.php?d=1001` });
    expect(threads[1]).toMatchObject({ title: "Ankündigung 2", url: `${BASE}/mod/forum/discuss.php?d=1002` });
  });

  it("returns empty array when no discussion links present", () => {
    const html = `<html><body><p>No threads here</p></body></html>`;
    expect(extractForumThreadUrls(html, BASE)).toHaveLength(0);
  });

  it("deduplicates the same discussion URL appearing multiple times", () => {
    const html = `<html><body>
      <a href="${BASE}/mod/forum/discuss.php?d=42">Thread A</a>
      <a href="${BASE}/mod/forum/discuss.php?d=42">Thread A again</a>
    </body></html>`;
    const threads = extractForumThreadUrls(html, BASE);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.url).toContain("d=42");
  });

  it("ignores profile, user, and navigation links (non-discuss.php hrefs)", () => {
    const html = `<html><body>
      <a href="${BASE}/user/profile.php?id=1">User Profile</a>
      <a href="${BASE}/mod/forum/view.php?id=5">Forum Index</a>
      <a href="${BASE}/mod/forum/discuss.php?d=99">Real Thread</a>
    </body></html>`;
    const threads = extractForumThreadUrls(html, BASE);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.url).toContain("d=99");
  });

  it("handles relative discuss.php URLs by prepending baseUrl", () => {
    const html = `<html><body>
      <a href="/mod/forum/discuss.php?d=200">Relative Thread</a>
    </body></html>`;
    const threads = extractForumThreadUrls(html, BASE);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.url).toBe(`${BASE}/mod/forum/discuss.php?d=200`);
  });

  it("caps thread list at 100 entries", () => {
    const links = Array.from({ length: 150 }, (_, i) =>
      `<a href="${BASE}/mod/forum/discuss.php?d=${i + 1}">Thread ${i + 1}</a>`
    ).join("\n");
    const html = `<html><body>${links}</body></html>`;
    const threads = extractForumThreadUrls(html, BASE);
    expect(threads).toHaveLength(100);
  });
});
