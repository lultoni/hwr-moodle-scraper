// Sidecar deduplication filter — runs after specialItems is classified, before the write loop.
// Suppresses .description.md sidecars whose content is redundant (exact substring of an existing
// .md file in the same dir, or a duplicate within the current batch), and consolidates very short
// descriptions (≤ SHORT_THRESHOLD chars) into a single _Beschreibungen.md per directory when ≥2
// such descriptions exist in the same folder.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Logger } from "../logger.js";

/** Maximum character length for a description to be treated as "short". */
const SHORT_THRESHOLD = 60;

export interface SidecarItem {
  item: { resourceId?: string; courseId?: number; url?: string };
  destPath: string;
  strategy: string;
  label: string;
  description?: string;
  activityType?: string;
  isSidecar: boolean;
}

export interface BeschreibungenFile {
  /** Absolute path to write _Beschreibungen.md into. */
  path: string;
  /** Formatted Markdown content (without trailing newline — caller appends "\n"). */
  content: string;
}

export interface FilterResult {
  /** specialItems array with suppressed/consolidated sidecars removed. */
  filteredItems: SidecarItem[];
  /** _Beschreibungen.md files to write (caller is responsible for atomicWrite + generatedFiles). */
  beschreibungenFiles: BeschreibungenFile[];
  /** Number of sidecars suppressed due to exact-duplicate content. */
  suppressedCount: number;
  /** Number of short descriptions merged into _Beschreibungen.md files. */
  consolidatedCount: number;
}

/**
 * Filter duplicate / short sidecar items from a specialItems batch.
 *
 * Must be called synchronously (no async I/O) after the classification loop in scrape.ts
 * and before the execution write loop.
 *
 * @param specialItems  The full specialItems array as built by the classification loop.
 * @param TurndownService  The Turndown constructor (passed in to avoid a second dynamic import).
 * @param logger  Optional logger for verbose [SUPPRESS-SIDECAR] / [SIDECAR-COLLECT] debug lines.
 */
export function filterSidecars(
  specialItems: SidecarItem[],
  TurndownService: new () => { turndown(html: string): string },
  logger?: Logger,
): FilterResult {
  // ── 1. Partition ──────────────────────────────────────────────────────────
  const passThrough: SidecarItem[] = [];
  const sidecarCandidates: SidecarItem[] = [];
  for (const item of specialItems) {
    if (item.isSidecar) {
      sidecarCandidates.push(item);
    } else {
      passThrough.push(item);
    }
  }

  if (sidecarCandidates.length === 0) {
    return { filteredItems: passThrough, beschreibungenFiles: [], suppressedCount: 0, consolidatedCount: 0 };
  }

  // ── 2. Convert HTML → MD for each candidate ───────────────────────────────
  const td = new TurndownService();
  const converted: Array<{ candidate: SidecarItem; descMd: string; dir: string }> = [];
  for (const candidate of sidecarCandidates) {
    const descMd = td.turndown(candidate.description ?? "").trim().normalize("NFC");
    const dir = dirname(candidate.destPath).normalize("NFC");
    converted.push({ candidate, descMd, dir });
  }

  // ── 3. Build disk inventory for each unique directory ────────────────────
  // Map<dirNFC, Map<filename, contentNFC>>
  const diskContent = new Map<string, Map<string, string>>();
  const uniqueDirs = new Set(converted.map((c) => c.dir));
  for (const dir of uniqueDirs) {
    if (!existsSync(dir)) {
      diskContent.set(dir, new Map());
      continue;
    }
    const fileMap = new Map<string, string>();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = entry.name.normalize("NFC");
      if (!name.endsWith(".md")) continue;
      try {
        const content = readFileSync(join(dir, entry.name), "utf8").normalize("NFC");
        fileMap.set(name, content);
      } catch {
        // Unreadable file — skip
      }
    }
    diskContent.set(dir, fileMap);
  }

  // ── 4. Batch text index: Map<dir, Set<descMd>> ───────────────────────────
  const batchSeen = new Map<string, Set<string>>();
  for (const dir of uniqueDirs) {
    batchSeen.set(dir, new Set());
  }

  // ── 4b. Build batch content index for non-sidecar items ──────────────────
  // Non-sidecar specialItems (page-md, info-md, label-md) will be written to disk
  // in the same run. Their description HTML, when converted to MD, should also be
  // checked against sidecars so first-run duplicates are caught.
  const batchNonSidecarContent = new Map<string, string[]>();
  for (const item of passThrough) {
    if (!item.description) continue;
    const dir = dirname(item.destPath).normalize("NFC");
    const mdContent = td.turndown(item.description).trim().normalize("NFC");
    if (!mdContent) continue;
    const arr = batchNonSidecarContent.get(dir) ?? [];
    arr.push(mdContent);
    batchNonSidecarContent.set(dir, arr);
  }

  // ── 5. Decide fate of each candidate ─────────────────────────────────────
  // Short descriptions to potentially consolidate: Map<dir, Array<{candidate, descMd}>>
  const shortsByDir = new Map<string, Array<{ candidate: SidecarItem; descMd: string }>>();

  const filteredSidecars: SidecarItem[] = [];
  let suppressedCount = 0;

  for (const { candidate, descMd, dir } of converted) {
    // (a) Duplicate in existing disk files
    const diskFiles = diskContent.get(dir) ?? new Map<string, string>();
    let foundInDisk = false;
    for (const [filename, content] of diskFiles) {
      if (content.includes(descMd)) {
        logger?.debug(`[SUPPRESS-SIDECAR] ${candidate.destPath} (duplicate in: ${filename})`);
        suppressedCount++;
        foundInDisk = true;
        break;
      }
    }
    if (foundInDisk) continue;

    // (a2) Duplicate in non-sidecar batch items (page-md, info-md, label-md being written this run)
    const batchContents = batchNonSidecarContent.get(dir) ?? [];
    let foundInBatch = false;
    for (const batchMd of batchContents) {
      if (batchMd.includes(descMd)) {
        logger?.debug(`[SUPPRESS-SIDECAR] ${candidate.destPath} (duplicate in: (batch-content))`);
        suppressedCount++;
        foundInBatch = true;
        break;
      }
    }
    if (foundInBatch) continue;

    // (b) Duplicate in current batch (same dir, same text)
    const seen = batchSeen.get(dir)!;
    if (seen.has(descMd)) {
      logger?.debug(`[SUPPRESS-SIDECAR] ${candidate.destPath} (duplicate in: (batch))`);
      suppressedCount++;
      continue;
    }

    // (c) Short description → consolidation bucket
    if (descMd.length <= SHORT_THRESHOLD) {
      const bucket = shortsByDir.get(dir) ?? [];
      bucket.push({ candidate, descMd });
      shortsByDir.set(dir, bucket);
      // Do NOT register in batchSeen here — short descs are handled separately
      continue;
    }

    // (d) Pass through — long, unique sidecar
    seen.add(descMd);
    filteredSidecars.push(candidate);
  }

  // ── 6. Consolidation of short descriptions ───────────────────────────────
  const beschreibungenFiles: BeschreibungenFile[] = [];
  let consolidatedCount = 0;

  for (const [dir, items] of shortsByDir) {
    if (items.length === 1) {
      // Only one short desc in this dir — keep as normal sidecar
      filteredSidecars.push(items[0]!.candidate);
    } else {
      // Two or more — consolidate into _Beschreibungen.md
      const lines = ["# Beschreibungen", ""];
      for (const { candidate, descMd } of items) {
        logger?.debug(`[SIDECAR-COLLECT] ${join(dir, "_Beschreibungen.md")} <- ${candidate.label} (${descMd})`);
        lines.push(`**${candidate.label}:** ${descMd}`);
      }
      beschreibungenFiles.push({
        path: join(dir, "_Beschreibungen.md"),
        content: lines.join("\n"),
      });
      consolidatedCount += items.length;
    }
  }

  // ── 7. Return ─────────────────────────────────────────────────────────────
  return {
    filteredItems: [...passThrough, ...filteredSidecars],
    beschreibungenFiles,
    suppressedCount,
    consolidatedCount,
  };
}
