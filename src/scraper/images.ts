// Download embedded Moodle images from markdown content, rewrite URLs to relative paths.
import { mkdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { downloadFile } from "./downloader.js";
import { isSameOrigin } from "../http/url-guard.js";

/** Regex to find markdown image references with Moodle pluginfile URLs. */
const MD_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^)]*\/pluginfile\.php\/[^)]+)\)/g;

export interface ImageDownloadResult {
  /** Markdown content with image URLs rewritten to relative paths. */
  content: string;
  /** Absolute paths of downloaded image files. */
  imagePaths: string[];
}

/**
 * Scan markdown for embedded Moodle pluginfile images, download each to an `images/`
 * subfolder next to the .md file, and rewrite the URL to a relative path.
 *
 * Only processes `pluginfile.php` URLs (authenticated Moodle content). External images
 * (YouTube thumbnails, etc.) are left as-is.
 */
export async function downloadEmbeddedImages(
  mdContent: string,
  mdFilePath: string,
  sessionCookies: string,
  retryBaseDelayMs: number,
  baseUrl?: string,
): Promise<ImageDownloadResult> {
  const imagePaths: string[] = [];
  const mdDir = dirname(mdFilePath);
  const imagesDir = join(mdDir, "images");

  // Collect all matches first (regex is stateful with /g)
  const matches: Array<{ full: string; alt: string; url: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = MD_IMAGE_RE.exec(mdContent)) !== null) {
    matches.push({ full: m[0], alt: m[1]!, url: m[2]! });
  }

  if (matches.length === 0) {
    return { content: mdContent, imagePaths };
  }

  mkdirSync(imagesDir, { recursive: true });

  let result = mdContent;
  // Track filenames to avoid collisions within the same images/ dir
  const usedNames = new Set<string>();

  for (const { full, alt, url } of matches) {
    try {
      // SSRF defense: skip image URLs that point to external domains
      if (baseUrl && !isSameOrigin(url, baseUrl)) continue;

      // Derive filename from URL
      const urlPath = new URL(url).pathname;
      let fname = decodeURIComponent(urlPath.split("/").pop() ?? "image.png");

      // Moodle serves thumbnails with s_ prefix (e.g. s_image.jpg).
      // Try the full-resolution version first by stripping s_ from filename.
      let downloadUrl = url;
      const originalFname = fname;
      if (fname.startsWith("s_")) {
        const fullResFname = fname.slice(2);
        try {
          const urlObj = new URL(url);
          const segments = urlObj.pathname.split("/");
          const lastSeg = segments[segments.length - 1];
          if (lastSeg) {
            segments[segments.length - 1] = encodeURIComponent(fullResFname);
            urlObj.pathname = segments.join("/");
            downloadUrl = urlObj.toString();
            fname = fullResFname;
          }
        } catch { /* keep original URL */ }
      }

      // Deduplicate filenames
      if (usedNames.has(fname)) {
        const dot = fname.lastIndexOf(".");
        const base = dot > 0 ? fname.slice(0, dot) : fname;
        const ext = dot > 0 ? fname.slice(dot) : "";
        let n = 2;
        while (usedNames.has(`${base}_${n}${ext}`)) n++;
        fname = `${base}_${n}${ext}`;
      }
      usedNames.add(fname);

      const destPath = join(imagesDir, fname);

      let finalResult: { finalPath: string };
      try {
        finalResult = await downloadFile({ url: downloadUrl, destPath, sessionCookies, retryBaseDelayMs });
      } catch {
        // If full-res URL failed and we stripped s_, fallback to original thumbnail URL
        if (downloadUrl !== url) {
          const thumbFname = originalFname;
          const thumbDest = join(imagesDir, thumbFname);
          finalResult = await downloadFile({ url, destPath: thumbDest, sessionCookies, retryBaseDelayMs });
        } else {
          throw new Error("download failed");
        }
      }
      imagePaths.push(finalResult.finalPath);

      // Rewrite URL to relative path from the .md file's directory
      const relPath = relative(mdDir, finalResult.finalPath).replace(/\\/g, "/");
      result = result.replace(full, `![${alt}](./${relPath})`);
    } catch {
      // Failed to download — leave original URL in place
    }
  }

  return { content: result, imagePaths };
}
