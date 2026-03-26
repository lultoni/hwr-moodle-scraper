// REQ-SCRAPE-003, REQ-SCRAPE-004, REQ-SCRAPE-009, REQ-SCRAPE-010, REQ-SCRAPE-011
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { request } from "undici";
import { atomicWrite } from "../fs/output.js";

export interface ProgressEvent {
  bytesReceived: number;
  totalBytes?: number;
}

export interface DownloadFileOptions {
  url: string;
  destPath: string;
  sessionCookies: string;
  onProgress?: (e: ProgressEvent) => void;
}

export async function downloadFile(opts: DownloadFileOptions): Promise<void> {
  const { url, destPath, sessionCookies, onProgress } = opts;
  const { body, headers } = await request(url, {
    headers: { cookie: sessionCookies },
  });

  const totalBytes = headers["content-length"]
    ? parseInt(headers["content-length"] as string, 10)
    : undefined;

  const chunks: Buffer[] = [];
  let bytesReceived = 0;

  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    chunks.push(buf);
    bytesReceived += buf.length;
    onProgress?.({ bytesReceived, totalBytes });
  }

  await atomicWrite(destPath, Buffer.concat(chunks));
}

export interface DownloadItem {
  url: string;
  destPath: string;
  sessionCookies: string;
  onProgress?: (e: ProgressEvent) => void;
}

export class DownloadQueue {
  private readonly maxConcurrent: number;

  constructor(opts: { maxConcurrent: number }) {
    this.maxConcurrent = opts.maxConcurrent;
  }

  async run(items: DownloadItem[]): Promise<void> {
    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(this.maxConcurrent);
    await Promise.all(items.map((item) => limit(() => downloadFile(item))));
  }
}
