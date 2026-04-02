// REQ-SCRAPE-003, REQ-SCRAPE-004, REQ-SCRAPE-009, REQ-SCRAPE-010, REQ-SCRAPE-011
import { atomicWrite } from "../fs/output.js";
import { withRetry } from "../http/retry.js";
import { extname, dirname, join, basename } from "node:path";
import { mkdirSync, renameSync } from "node:fs";

export interface ProgressEvent {
  bytesReceived: number;
  totalBytes?: number;
}

export interface DownloadFileOptions {
  url: string;
  destPath: string;
  sessionCookies: string;
  onProgress?: (e: ProgressEvent) => void;
  onComplete?: (finalPath: string) => void;
  /** Base delay in ms for exponential backoff retries. Default 5000. */
  retryBaseDelayMs?: number;
}

export interface DownloadFileResult {
  /** The path the file was actually written to (may differ from destPath if an extension was appended). */
  finalPath: string;
  /** SHA-256 hex digest of the downloaded file content. */
  hash: string;
}

/** True for transient network errors that warrant a retry. */
function isNetworkError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("other side closed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("und_err") ||
    msg.includes("connect timeout") ||
    msg.includes("network error")
  );
}

/**
 * Map common MIME types to file extensions.
 * Only maps types that represent downloadable binary/document files.
 * text/html is intentionally excluded — it means we received a Moodle page, not a file.
 */
const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.oasis.opendocument.text": ".odt",
  "application/vnd.oasis.opendocument.spreadsheet": ".ods",
  "application/vnd.oasis.opendocument.presentation": ".odp",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/markdown": ".md",
  "application/json": ".json",
  "application/xml": ".xml",
  "text/xml": ".xml",
  "audio/mpeg": ".mp3",
  "video/mp4": ".mp4",
  "application/octet-stream": ".bin",
  "application/x-tar": ".tar",
  "application/gzip": ".gz",
  "application/x-7z-compressed": ".7z",
  "application/x-rar-compressed": ".rar",
};

/**
 * Extract the best filename from response headers and/or the final URL.
 * Returns null if nothing useful is found.
 */
export function extractFilename(
  headers: Record<string, string | string[] | undefined>,
  finalUrl: string,
): string | null {
  // 1. Content-Disposition: attachment; filename="foo.pdf"
  const cd = headers["content-disposition"];
  const cdStr = Array.isArray(cd) ? cd[0] : cd;
  if (cdStr) {
    const m = /filename="([^"]+)"/i.exec(cdStr) ?? /filename=([^\s;]+)/i.exec(cdStr);
    if (m?.[1]) {
      const extracted = decodeURIComponent(m[1].trim());
      // Guard against path traversal: strip any directory components
      if (extracted.includes("..") || extracted.startsWith("/")) {
        return basename(extracted);
      }
      return extracted;
    }
  }

  // 2. Final URL pathname (strip query string, decode)
  // Skip .php URLs — they are Moodle dispatch pages, not actual files.
  // Content-Type fallback (step 3) handles the real extension in those cases.
  try {
    const u = new URL(finalUrl);
    const seg = u.pathname.split("/").pop() ?? "";
    const decoded = decodeURIComponent(seg);
    const ext = extname(decoded).toLowerCase();
    if (decoded && decoded !== "/" && ext && ext !== ".php") return decoded;
  } catch {
    // ignore invalid URLs
  }

  // 3. Derive extension from Content-Type header (last resort for extensionless Moodle view URLs)
  const ct = headers["content-type"];
  const ctStr = Array.isArray(ct) ? ct[0] : ct;
  if (ctStr) {
    const mimeType = ctStr.split(";")[0]?.trim().toLowerCase();
    if (mimeType && MIME_TO_EXT[mimeType]) {
      // Use the last URL path segment as a basename, stripping query params
      try {
        const u = new URL(finalUrl);
        const seg = decodeURIComponent(u.pathname.split("/").pop() ?? "").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "") || "file";
        return seg + MIME_TO_EXT[mimeType]!;
      } catch {
        return "file" + MIME_TO_EXT[mimeType]!;
      }
    }
  }

  return null;
}

/**
 * When Moodle serves a resource with display type "In frame" (eingebettet),
 * it returns a 200 HTML page instead of redirecting. The actual file URL
 * is embedded as an <iframe src="pluginfile.php/..."> or fallback <a href>.
 * Extract that URL so we can follow it to the real file.
 */
function extractEmbeddedPluginfileUrl(html: string, baseUrl: string): string | null {
  // Match <a href="...pluginfile.php/..."> inside the resourcecontent block
  // (the fallback link is cleaner — no ?embed=1 suffix)
  const m = /id="resourceobject"[\s\S]{0,500}?<a\s[^>]*href="(https?:\/\/[^"]*pluginfile\.php\/[^"?]+)"/.exec(html)
    ?? /class="resourcecontent[^"]*"[\s\S]{0,1000}?<a\s[^>]*href="(https?:\/\/[^"]*pluginfile\.php\/[^"?]+)"/.exec(html);
  if (m?.[1]) return m[1]!;
  // Fallback: iframe src without ?embed=1
  const iframeM = /id="resourceobject"\s[^>]*src="(https?:\/\/[^"]*pluginfile\.php\/[^"?]+)"/.exec(html);
  if (iframeM?.[1]) return iframeM[1]!;
  // Fallback: resourceworkaround popup link — <div class="resourceworkaround"><a href="...pluginfile.php/...">
  const workaroundM = /class="resourceworkaround"[\s\S]{0,500}?<a\s[^>]*href="(https?:\/\/[^"]*pluginfile\.php\/[^"?]+)"/.exec(html);
  if (workaroundM?.[1]) return workaroundM[1]!;
  return null;
}

export async function downloadFile(opts: DownloadFileOptions): Promise<DownloadFileResult> {
  const { url, destPath, sessionCookies, onProgress, onComplete, retryBaseDelayMs = 5000 } = opts;

  let finalPath = destPath;
  let computedHash = "";

  await withRetry(
    async () => {
      const { request } = await import("undici");
      let currentUrl = url;
      const maxRedirects = 10;

      for (let hop = 0; hop <= maxRedirects; hop++) {
        if (!currentUrl.startsWith("https://")) throw new Error(`Insecure redirect URL rejected (http:// not allowed): ${currentUrl}`);

        const { statusCode, headers, body } = await request(currentUrl, {
          headers: { cookie: sessionCookies },
        });

        // Follow redirects
        if (statusCode >= 300 && statusCode < 400) {
          const location = headers["location"];
          if (!location) break;
          const loc = Array.isArray(location) ? location[0]! : location;
          currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).toString();
          await body.dump();
          continue;
        }

        // Determine the actual filename/extension from headers + final URL
        const extractedName = extractFilename(
          headers as Record<string, string | string[] | undefined>,
          currentUrl,
        );

        // If destPath has no extension and we found one, rename destination
        if (extractedName && !extname(destPath)) {
          const ext = extname(extractedName);
          finalPath = ext ? destPath + ext : join(dirname(destPath), extractedName);
        }

        const totalBytes = headers["content-length"]
          ? parseInt(headers["content-length"] as string, 10)
          : undefined;

        // Note: entire file is buffered in memory before writing.
        // Acceptable for typical Moodle files (<50 MB). If video streaming is added,
        // switch to a pipe-based atomic write to avoid holding large buffers.
        const chunks: Buffer[] = [];
        let bytesReceived = 0;

        for await (const chunk of body) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          chunks.push(buf);
          bytesReceived += buf.length;
          onProgress?.({ bytesReceived, ...(totalBytes !== undefined ? { totalBytes } : {}) });
        }

        // Moodle "display in frame" delivers a 200 HTML wrapper page instead of
        // redirecting. Detect this and follow the embedded pluginfile.php link.
        const ctStr = (Array.isArray(headers["content-type"]) ? headers["content-type"][0] : headers["content-type"]) ?? "";
        if (ctStr.startsWith("text/html")) {
          const html = Buffer.concat(chunks).toString("utf8");
          const pluginUrl = extractEmbeddedPluginfileUrl(html, currentUrl);
          if (pluginUrl) {
            currentUrl = pluginUrl;
            // Reset finalPath — extractFilename will re-derive it from the new URL
            finalPath = destPath;
            continue;
          }
          // No embedded file link found — fall through and save the HTML as-is
          // (will be flagged by file-checker; nothing better we can do here)
        }

        mkdirSync(dirname(finalPath), { recursive: true });
        const { hash } = await atomicWrite(finalPath, Buffer.concat(chunks));
        // Store hash on the outer variable so it's accessible after the retry closure
        computedHash = hash;
        return;
      }

      throw new Error(`Too many redirects downloading ${url}`);
    },
    {
      maxAttempts: 5,
      baseDelayMs: retryBaseDelayMs,
      shouldRetry: isNetworkError,
    },
  );

  onComplete?.(finalPath);
  return { finalPath, hash: computedHash };
}

export interface DownloadItem {
  url: string;
  destPath: string;
  sessionCookies: string;
  onProgress?: (e: ProgressEvent) => void;
  onComplete?: (finalPath: string) => void;
  retryBaseDelayMs?: number;
}

export interface DownloadQueueResult {
  downloaded: number;
  /** Per-item results (index matches input items array). undefined if the item failed. */
  finalPaths: Array<{ path: string; hash: string } | undefined>;
  failed: Array<{ item: DownloadItem; error: Error }>;
}

export class DownloadQueue {
  private readonly maxConcurrent: number;

  constructor(opts: { maxConcurrent: number }) {
    this.maxConcurrent = opts.maxConcurrent;
  }

  async run(items: DownloadItem[]): Promise<DownloadQueueResult> {
    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(this.maxConcurrent);

    const results = await Promise.allSettled(
      items.map((item, index) =>
        limit(() => downloadFile(item).then((r) => ({ index, result: r }))),
      ),
    );

    const failed: DownloadQueueResult["failed"] = [];
    const finalPaths: Array<{ path: string; hash: string } | undefined> = new Array(items.length).fill(undefined);
    let downloaded = 0;

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === "fulfilled") {
        downloaded++;
        finalPaths[r.value.index] = { path: r.value.result.finalPath, hash: r.value.result.hash };
      } else {
        failed.push({ item: items[i]!, error: r.reason as Error });
      }
    }

    return { downloaded, finalPaths, failed };
  }
}
