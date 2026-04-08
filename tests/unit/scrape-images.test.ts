import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

// Mock node:fs with memfs
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return { ...memfs.fs, default: memfs.fs };
});

// Mock downloader — no real HTTP
vi.mock("../../src/scraper/downloader.js", () => ({
  downloadFile: vi.fn(),
}));

import { downloadEmbeddedImages } from "../../src/scraper/images.js";
import { downloadFile } from "../../src/scraper/downloader.js";

const mockedDownloadFile = vi.mocked(downloadFile);

beforeEach(() => {
  vol.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadEmbeddedImages", () => {
  const cookies = "MoodleSession=abc123";
  const retryMs = 100;

  it("returns content unchanged when no pluginfile images exist", async () => {
    const md = "# Hello\n\nSome text with ![ext](https://example.com/photo.png)";
    const result = await downloadEmbeddedImages(md, "/out/Course/Section/page.md", cookies, retryMs);
    expect(result.content).toBe(md);
    expect(result.imagePaths).toEqual([]);
    expect(mockedDownloadFile).not.toHaveBeenCalled();
  });

  it("downloads pluginfile images and rewrites URLs to relative paths", async () => {
    vol.fromJSON({ "/out/Course/Section/placeholder": "" });

    const url = "https://moodle.hwr-berlin.de/pluginfile.php/123456/mod_page/content/1/diagram.png";
    const md = `# Topic\n\n![Diagram](${url})\n\nMore text`;

    mockedDownloadFile.mockResolvedValueOnce({
      finalPath: "/out/Course/Section/images/diagram.png",
      hash: "abc123",
    });

    const result = await downloadEmbeddedImages(md, "/out/Course/Section/page.md", cookies, retryMs);

    expect(mockedDownloadFile).toHaveBeenCalledWith({
      url,
      destPath: "/out/Course/Section/images/diagram.png",
      sessionCookies: cookies,
      retryBaseDelayMs: retryMs,
    });
    expect(result.content).toBe("# Topic\n\n![Diagram](./images/diagram.png)\n\nMore text");
    expect(result.imagePaths).toEqual(["/out/Course/Section/images/diagram.png"]);
  });

  it("handles multiple images in the same markdown", async () => {
    vol.fromJSON({ "/out/Course/Section/placeholder": "" });

    const url1 = "https://moodle.hwr-berlin.de/pluginfile.php/111/mod_page/content/1/img1.png";
    const url2 = "https://moodle.hwr-berlin.de/pluginfile.php/222/mod_page/content/1/img2.jpg";
    const md = `![A](${url1})\n\n![B](${url2})`;

    mockedDownloadFile
      .mockResolvedValueOnce({ finalPath: "/out/Course/Section/images/img1.png", hash: "h1" })
      .mockResolvedValueOnce({ finalPath: "/out/Course/Section/images/img2.jpg", hash: "h2" });

    const result = await downloadEmbeddedImages(md, "/out/Course/Section/page.md", cookies, retryMs);

    expect(result.content).toBe("![A](./images/img1.png)\n\n![B](./images/img2.jpg)");
    expect(result.imagePaths).toHaveLength(2);
  });

  it("deduplicates filenames within the same batch", async () => {
    vol.fromJSON({ "/out/Course/Section/placeholder": "" });

    const url1 = "https://moodle.hwr-berlin.de/pluginfile.php/111/mod_page/content/1/image.png";
    const url2 = "https://moodle.hwr-berlin.de/pluginfile.php/222/mod_page/content/1/image.png";
    const md = `![A](${url1})\n![B](${url2})`;

    mockedDownloadFile
      .mockResolvedValueOnce({ finalPath: "/out/Course/Section/images/image.png", hash: "h1" })
      .mockResolvedValueOnce({ finalPath: "/out/Course/Section/images/image_2.png", hash: "h2" });

    const result = await downloadEmbeddedImages(md, "/out/Course/Section/page.md", cookies, retryMs);

    // Second image should get deduplicated filename
    expect(mockedDownloadFile).toHaveBeenCalledTimes(2);
    const secondCall = mockedDownloadFile.mock.calls[1]![0] as { destPath: string };
    expect(secondCall.destPath).toBe("/out/Course/Section/images/image_2.png");
    expect(result.imagePaths).toHaveLength(2);
  });

  it("leaves original URL when download fails", async () => {
    vol.fromJSON({ "/out/Course/Section/placeholder": "" });

    const url = "https://moodle.hwr-berlin.de/pluginfile.php/999/mod_page/content/1/broken.png";
    const md = `![Broken](${url})`;

    mockedDownloadFile.mockRejectedValueOnce(new Error("404 Not Found"));

    const result = await downloadEmbeddedImages(md, "/out/Course/Section/page.md", cookies, retryMs);

    expect(result.content).toBe(md); // unchanged
    expect(result.imagePaths).toEqual([]);
  });

  it("ignores non-pluginfile images (YouTube thumbnails etc.)", async () => {
    const md = "![thumb](https://img.youtube.com/vi/abc/0.jpg)\n![local](./images/already-local.png)";
    const result = await downloadEmbeddedImages(md, "/out/Section/page.md", cookies, retryMs);
    expect(result.content).toBe(md);
    expect(mockedDownloadFile).not.toHaveBeenCalled();
  });

  it("decodes percent-encoded filenames from URL", async () => {
    vol.fromJSON({ "/out/Section/placeholder": "" });

    const url = "https://moodle.hwr-berlin.de/pluginfile.php/123/mod_page/content/1/%C3%9Cbersicht.png";
    const md = `![Übersicht](${url})`;

    mockedDownloadFile.mockResolvedValueOnce({
      finalPath: "/out/Section/images/Übersicht.png",
      hash: "h1",
    });

    const result = await downloadEmbeddedImages(md, "/out/Section/page.md", cookies, retryMs);

    const call = mockedDownloadFile.mock.calls[0]![0] as { destPath: string };
    expect(call.destPath).toBe("/out/Section/images/Übersicht.png");
    expect(result.content).toContain("./images/Übersicht.png");
  });
});
