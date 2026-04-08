// Download embedded Moodle images from markdown content, rewrite URLs to relative paths.
import { mkdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { downloadFile } from "./downloader.js";

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
      // Derive filename from URL
      const urlPath = new URL(url).pathname;
      let fname = decodeURIComponent(urlPath.split("/").pop() ?? "image.png");
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
      const { finalPath } = await downloadFile({ url, destPath, sessionCookies, retryBaseDelayMs });
      imagePaths.push(finalPath);

      // Rewrite URL to relative path from the .md file's directory
      const relPath = relative(mdDir, finalPath).replace(/\\/g, "/");
      result = result.replace(full, `![${alt}](./${relPath})`);
    } catch {
      // Failed to download — leave original URL in place
    }
  }

  return { content: result, imagePaths };
}
