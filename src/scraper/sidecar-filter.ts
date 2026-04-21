// Sidecar deduplication filter — runs after specialItems is classified, before the write loop.
// Suppresses .description.md sidecars whose content is redundant (exact substring of an existing
// .md file in the same dir, or a duplicate within the current batch), and consolidates very short
// descriptions (≤ SHORT_THRESHOLD chars) into a single _Descriptions.md per directory when ≥2
// such descriptions exist in the same folder.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createTurndown } from "./turndown.js";
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

export interface DescriptionsFile {
  /** Absolute path to write _Descriptions.md into. */
  path: string;
  /** Formatted Markdown content (without trailing newline — caller appends "\n"). */
  content: string;
}

export interface FilterResult {
  /** specialItems array with suppressed/consolidated sidecars removed. */
  filteredItems: SidecarItem[];
  /** _Descriptions.md files to write (caller is responsible for atomicWrite + generatedFiles). */
  descriptionsFiles: DescriptionsFile[];
  /** Number of sidecars suppressed due to exact-duplicate content. */
  suppressedCount: number;
  /** Number of short descriptions merged into _Descriptions.md files. */
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
  _TurndownService?: new () => { turndown(html: string): string },
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
    // No sidecars, but still run label-md cross-dedup
    const td = createTurndown();
    let suppressedCount = 0;

    // Build disk content for label-md dirs
    const labelDirs = new Set<string>();
    for (const item of passThrough) {
      if (item.strategy === "label-md") labelDirs.add(dirname(item.destPath).normalize("NFC"));
    }
    const diskContent = new Map<string, Map<string, string>>();
    for (const dir of labelDirs) {
      if (!existsSync(dir)) { diskContent.set(dir, new Map()); continue; }
      const fileMap = new Map<string, string>();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const name = entry.name.normalize("NFC");
        if (!name.endsWith(".md")) continue;
        try { fileMap.set(name, readFileSync(join(dir, entry.name), "utf8").normalize("NFC")); } catch {}
      }
      diskContent.set(dir, fileMap);
    }

    const labelMdIndices = new Set<number>();
    for (let i = 0; i < passThrough.length; i++) {
      const item = passThrough[i]!;
      if (item.strategy !== "label-md" || !item.description) continue;
      const dir = dirname(item.destPath).normalize("NFC");
      let labelMd: string;
      try {
        labelMd = td.turndown(item.description).trim().normalize("NFC");
      } catch { continue; }
      if (!labelMd) continue;
      for (let j = 0; j < passThrough.length; j++) {
        if (i === j) continue;
        const other = passThrough[j]!;
        if (!other.description) continue;
        if (dirname(other.destPath).normalize("NFC") !== dir) continue;
        let otherMd: string;
        try {
          otherMd = td.turndown(other.description).trim().normalize("NFC");
        } catch { continue; }
        if (otherMd.includes(labelMd)) {
          labelMdIndices.add(i);
          suppressedCount++;
          logger?.debug(`[SUPPRESS-LABEL-MD] ${item.destPath} (duplicate of: ${other.destPath})`);
          break;
        }
      }
    }
    for (let i = 0; i < passThrough.length; i++) {
      if (labelMdIndices.has(i)) continue;
      const item = passThrough[i]!;
      if (item.strategy !== "label-md" || !item.description) continue;
      const dir = dirname(item.destPath).normalize("NFC");
      let labelMd: string;
      try {
        labelMd = td.turndown(item.description).trim().normalize("NFC");
      } catch { continue; }
      if (!labelMd) continue;
      const diskFiles = diskContent.get(dir) ?? new Map<string, string>();
      for (const [, content] of diskFiles) {
        if (content.includes(labelMd)) { labelMdIndices.add(i); suppressedCount++; break; }
      }
    }
    if (labelMdIndices.size > 0) {
      const cleaned = passThrough.filter((_, i) => !labelMdIndices.has(i));
      return { filteredItems: cleaned, descriptionsFiles: [], suppressedCount, consolidatedCount: 0 };
    }
    return { filteredItems: passThrough, descriptionsFiles: [], suppressedCount: 0, consolidatedCount: 0 };
  }

  // ── 2. Convert HTML → MD for each candidate ───────────────────────────────
  const td = createTurndown();
  const converted: Array<{ candidate: SidecarItem; descMd: string; dir: string }> = [];
  for (const candidate of sidecarCandidates) {
    let descMd: string;
    try {
      descMd = td.turndown(candidate.description ?? "").trim().normalize("NFC");
    } catch { continue; }
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
    let mdContent: string;
    try {
      mdContent = td.turndown(item.description).trim().normalize("NFC");
    } catch { continue; }
    if (!mdContent) continue;
    const arr = batchNonSidecarContent.get(dir) ?? [];
    arr.push(mdContent);
    batchNonSidecarContent.set(dir, arr);
  }

  // ── 4c. Cross-dedup label-md items against other items in same dir ────────
  // A label-md whose description is a subset of another item's description (e.g.
  // "Teams Meeting" label with same content as "Virtual Meeting Space" info-md)
  // is suppressed. Only non-sidecar items are checked against each other.
  let suppressedCount = 0;
  const labelMdIndices = new Set<number>();
  for (let i = 0; i < passThrough.length; i++) {
    const item = passThrough[i]!;
    if (item.strategy !== "label-md" || !item.description) continue;
    const dir = dirname(item.destPath).normalize("NFC");
    let labelMd: string;
    try {
      labelMd = td.turndown(item.description).trim().normalize("NFC");
    } catch { continue; }
    if (!labelMd) continue;
    // Check against other non-sidecar items in same dir
    for (let j = 0; j < passThrough.length; j++) {
      if (i === j) continue;
      const other = passThrough[j]!;
      if (!other.description) continue;
      const otherDir = dirname(other.destPath).normalize("NFC");
      if (otherDir !== dir) continue;
      let otherMd: string;
      try {
        otherMd = td.turndown(other.description).trim().normalize("NFC");
      } catch { continue; }
      if (otherMd.includes(labelMd)) {
        labelMdIndices.add(i);
        suppressedCount++;
        logger?.debug(`[SUPPRESS-LABEL-MD] ${item.destPath} (duplicate of: ${other.destPath})`);
        break;
      }
    }
  }
  // Also check label-md against existing disk files in same dir
  for (let i = 0; i < passThrough.length; i++) {
    if (labelMdIndices.has(i)) continue;
    const item = passThrough[i]!;
    if (item.strategy !== "label-md" || !item.description) continue;
    const dir = dirname(item.destPath).normalize("NFC");
    let labelMd: string;
    try {
      labelMd = td.turndown(item.description).trim().normalize("NFC");
    } catch { continue; }
    if (!labelMd) continue;
    const diskFiles = diskContent.get(dir) ?? new Map<string, string>();
    for (const [filename, content] of diskFiles) {
      if (content.includes(labelMd)) {
        labelMdIndices.add(i);
        suppressedCount++;
        logger?.debug(`[SUPPRESS-LABEL-MD] ${item.destPath} (duplicate in disk: ${filename})`);
        break;
      }
    }
  }
  // Remove suppressed label-md items from passThrough
  if (labelMdIndices.size > 0) {
    const cleaned: SidecarItem[] = [];
    for (let i = 0; i < passThrough.length; i++) {
      if (!labelMdIndices.has(i)) cleaned.push(passThrough[i]!);
    }
    passThrough.length = 0;
    passThrough.push(...cleaned);
  }

  // ── 5. Decide fate of each candidate ─────────────────────────────────────
  // Short descriptions to potentially consolidate: Map<dir, Array<{candidate, descMd}>>
  const shortsByDir = new Map<string, Array<{ candidate: SidecarItem; descMd: string }>>();

  const filteredSidecars: SidecarItem[] = [];

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
  const descriptionsFiles: DescriptionsFile[] = [];
  let consolidatedCount = 0;

  for (const [dir, items] of shortsByDir) {
    // Deduplicate by descMd — identical texts should appear only once
    const seen = new Set<string>();
    const unique: typeof items = [];
    for (const entry of items) {
      if (seen.has(entry.descMd)) {
        suppressedCount++;
        continue;
      }
      seen.add(entry.descMd);
      unique.push(entry);
    }

    if (unique.length === 1) {
      // Only one unique short desc in this dir — keep as normal sidecar
      filteredSidecars.push(unique[0]!.candidate);
    } else {
      // Two or more unique — consolidate into _Descriptions.md
      const lines = ["# Descriptions", ""];
      for (const { candidate, descMd } of unique) {
        logger?.debug(`[SIDECAR-COLLECT] ${join(dir, "_Descriptions.md")} <- ${candidate.label} (${descMd})`);
        lines.push(`**${candidate.label}:** ${descMd}`);
      }
      descriptionsFiles.push({
        path: join(dir, "_Descriptions.md"),
        content: lines.join("\n"),
      });
      consolidatedCount += unique.length;
    }
  }

  // ── 7. Return ─────────────────────────────────────────────────────────────
  return {
    filteredItems: [...passThrough, ...filteredSidecars],
    descriptionsFiles,
    suppressedCount,
    consolidatedCount,
  };
}
