// Tests for forum thread URL extraction and deep-dive fetching.
// src/scraper/forum.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from "undici";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractForumThreadUrls, extractPageContent, extractEmbeddedVideoUrls } from "../../src/scraper/forum.js";

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

  it("BUG-B: deduplicates subject link vs last-post link (&parent= variant)", () => {
    // Forum index shows each thread twice: subject link (d=NNN) and last-post link (d=NNN&parent=MMM)
    const html = `<html><body>
      <a href="${BASE}/mod/forum/discuss.php?d=329795">Aufgabe für TAG 6</a>
      <a href="${BASE}/mod/forum/discuss.php?d=329795&parent=430827">26. Nov. 2024</a>
      <a href="${BASE}/mod/forum/discuss.php?d=328403">Aufgabe für TAG 3</a>
      <a href="${BASE}/mod/forum/discuss.php?d=328403&parent=429283">16. Nov. 2024</a>
    </body></html>`;
    const threads = extractForumThreadUrls(html, BASE);
    // Must produce exactly 2 threads, not 4
    expect(threads).toHaveLength(2);
    // Canonical URLs should not contain &parent=
    expect(threads[0]?.url).not.toContain("parent");
    expect(threads[1]?.url).not.toContain("parent");
    expect(threads[0]?.url).toContain("d=329795");
    expect(threads[1]?.url).toContain("d=328403");
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

describe("extractPageContent — unit tests", () => {
  const MOODLE_CHROME = `<html><head><style>body{}</style></head><body>
    <nav>Navigation bar</nav>
    <div role="main"><h1>Forum Title</h1><p>Actual content</p></div>
    <footer>Footer stuff</footer>
    <script>var x = 1;</script>
  </body></html>`;

  it("extracts content from <div role=\"main\">", () => {
    const result = extractPageContent(MOODLE_CHROME);
    expect(result).toContain("Actual content");
    expect(result).not.toContain("Navigation bar");
    expect(result).not.toContain("Footer stuff");
  });

  it("falls back to <div id=\"page-content\"> when role=main absent", () => {
    const html = `<html><body>
      <div id="page-content"><p>Page content here</p></div>
      <footer>Footer</footer>
    </body></html>`;
    const result = extractPageContent(html);
    expect(result).toContain("Page content here");
    expect(result).not.toContain("Footer");
  });

  it("falls back to full HTML when no known container found", () => {
    const html = `<html><body><p>No known container</p></body></html>`;
    const result = extractPageContent(html);
    expect(result).toContain("No known container");
  });

  it("correctly handles nested divs inside role=main", () => {
    const html = `<html><body>
      <div role="main">
        <div class="outer"><div class="inner"><p>Deep content</p></div></div>
      </div>
      <aside>Sidebar</aside>
    </body></html>`;
    const result = extractPageContent(html);
    expect(result).toContain("Deep content");
    expect(result).not.toContain("Sidebar");
  });
});

describe("extractEmbeddedVideoUrls — iframe/consent wrapper extraction", () => {
  it("extracts YouTube URL from iframe data-src behind consent wrapper", () => {
    const html = `<div role="main">
      <p>Das Video wird mit Youtube abgespielt. Mit Anklicken willigen Sie ein.</p>
      <iframe data-src="https://www.youtube.com/embed/dQw4w9WgXcQ" class="mediaplugin"></iframe>
    </div>`;
    const result = extractEmbeddedVideoUrls(html);
    expect(result).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("extracts YouTube URL from iframe src attribute", () => {
    const html = `<iframe src="https://www.youtube.com/embed/abc123?rel=0" width="600"></iframe>`;
    const result = extractEmbeddedVideoUrls(html);
    expect(result).toContain("https://www.youtube.com/watch?v=abc123");
  });

  it("returns empty string when no video embeds found", () => {
    const html = `<div role="main"><p>Just text, no videos.</p></div>`;
    expect(extractEmbeddedVideoUrls(html)).toBe("");
  });

  it("deduplicates same video appearing multiple times", () => {
    const html = `
      <iframe data-src="https://www.youtube.com/embed/xyz789"></iframe>
      <iframe src="https://www.youtube.com/embed/xyz789"></iframe>`;
    const result = extractEmbeddedVideoUrls(html);
    const matches = result.match(/youtube\.com/g);
    expect(matches).toHaveLength(1);
  });

  it("handles youtu.be short URLs", () => {
    const html = `<iframe src="https://youtu.be/shortVid123"></iframe>`;
    const result = extractEmbeddedVideoUrls(html);
    expect(result).toContain("youtu.be/shortVid123");
  });

  it("handles Vimeo embed URLs", () => {
    const html = `<iframe data-src="https://player.vimeo.com/video/987654"></iframe>`;
    const result = extractEmbeddedVideoUrls(html);
    expect(result).toContain("vimeo.com");
  });

  it("extracts YouTube URL from filter_youtube_sanitizer data-embed-frame attribute", () => {
    // Real HWR Moodle HTML: filter_youtube_sanitizer wraps videos in a consent overlay
    // with the iframe markup HTML-encoded in data-embed-frame
    const html = `<div class="yt-container_inner">
      <div class="yt-player" data-embed-frame="&lt;iframe width=&quot;100%&quot; height=&quot;100%&quot; src=&quot;https://www.youtube-nocookie.com/embed/EIrAYddf1Ak?feature=oembed&amp;autoplay=1&quot; frameborder=&quot;0&quot; allow=&quot;accelerometer; autoplay&quot; allowfullscreen title=&quot;Theoretische Informatik&quot;&gt;&lt;/iframe&gt;">
        <svg class="yt-privacy-play-btn"></svg>
      </div>
    </div>`;
    const result = extractEmbeddedVideoUrls(html);
    expect(result).toContain("https://www.youtube.com/watch?v=EIrAYddf1Ak");
  });

  it("handles youtube-nocookie.com domain in iframe src", () => {
    const html = `<iframe src="https://www.youtube-nocookie.com/embed/Test123?rel=0"></iframe>`;
    const result = extractEmbeddedVideoUrls(html);
    expect(result).toContain("https://www.youtube.com/watch?v=Test123");
  });
});
