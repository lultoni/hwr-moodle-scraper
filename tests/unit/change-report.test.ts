// Covers: fix for false "~ updated" in change report
//
// Verifies the hash-guard logic that determines whether a re-fetched file
// is included in the change report. A file should only appear as "~ updated"
// when its computed SHA-256 actually differs from the previously stored hash.

import { describe, it, expect } from "vitest";

// ── Pure logic extracted for unit testing ────────────────────────────────────
// The production code lives in scrape.ts but the decision logic is:
//   isNew  = resourceId not in existingResourceIds
//   contentChanged = isNew || !prevHash || computedHash !== prevHash
//   include in changeEntries iff contentChanged

function shouldIncludeInChangeReport(opts: {
  resourceId: string;
  computedHash: string;
  existingResourceIds: Set<string>;
  previousHashes: Map<string, string>;
}): { include: boolean; isNew: boolean } {
  const { resourceId, computedHash, existingResourceIds, previousHashes } = opts;
  const isNew = !existingResourceIds.has(resourceId);
  const prevHash = previousHashes.get(resourceId) ?? "";
  const contentChanged = isNew || !prevHash || computedHash !== prevHash;
  return { include: contentChanged, isNew };
}

describe("Change report: hash-guard logic", () => {
  it("includes new files (resourceId not in state) regardless of hash", () => {
    const result = shouldIncludeInChangeReport({
      resourceId: "new-resource",
      computedHash: "abc123",
      existingResourceIds: new Set(),
      previousHashes: new Map(),
    });
    expect(result.include).toBe(true);
    expect(result.isNew).toBe(true);
  });

  it("includes file as updated (+) when no previous hash is stored", () => {
    // Re-fetched item exists in state but has no stored hash (legacy state)
    const result = shouldIncludeInChangeReport({
      resourceId: "resource-1",
      computedHash: "abc123",
      existingResourceIds: new Set(["resource-1"]),
      previousHashes: new Map(), // no hash stored
    });
    expect(result.include).toBe(true);
    expect(result.isNew).toBe(false);
  });

  it("does NOT include file when computed hash matches previous hash (content unchanged)", () => {
    const result = shouldIncludeInChangeReport({
      resourceId: "resource-1",
      computedHash: "deadbeef",
      existingResourceIds: new Set(["resource-1"]),
      previousHashes: new Map([["resource-1", "deadbeef"]]),
    });
    expect(result.include).toBe(false);
  });

  it("includes file as updated when computed hash differs from previous hash", () => {
    const result = shouldIncludeInChangeReport({
      resourceId: "resource-1",
      computedHash: "newHash456",
      existingResourceIds: new Set(["resource-1"]),
      previousHashes: new Map([["resource-1", "oldHash123"]]),
    });
    expect(result.include).toBe(true);
    expect(result.isNew).toBe(false);
  });

  it("second run with identical content produces no change entries", () => {
    // Simulate: 3 files were downloaded, all with same hash as stored
    const existingResourceIds = new Set(["r1", "r2", "r3"]);
    const previousHashes = new Map([["r1", "h1"], ["r2", "h2"], ["r3", "h3"]]);

    const downloads = [
      { resourceId: "r1", computedHash: "h1" },
      { resourceId: "r2", computedHash: "h2" },
      { resourceId: "r3", computedHash: "h3" },
    ];

    const changeEntries = downloads
      .map((d) => shouldIncludeInChangeReport({ ...d, existingResourceIds, previousHashes }))
      .filter((r) => r.include);

    expect(changeEntries).toHaveLength(0);
  });

  it("third run with one changed file produces exactly one change entry", () => {
    const existingResourceIds = new Set(["r1", "r2", "r3"]);
    const previousHashes = new Map([["r1", "h1"], ["r2", "h2"], ["r3", "h3"]]);

    const downloads = [
      { resourceId: "r1", computedHash: "h1" },        // unchanged
      { resourceId: "r2", computedHash: "h2-changed" }, // changed
      { resourceId: "r3", computedHash: "h3" },        // unchanged
    ];

    const changeEntries = downloads
      .map((d) => shouldIncludeInChangeReport({ ...d, existingResourceIds, previousHashes }))
      .filter((r) => r.include);

    expect(changeEntries).toHaveLength(1);
    expect(changeEntries[0]!.isNew).toBe(false);
  });

  it("first run (empty state) marks all files as new (+)", () => {
    const existingResourceIds = new Set<string>();
    const previousHashes = new Map<string, string>();

    const downloads = [
      { resourceId: "r1", computedHash: "h1" },
      { resourceId: "r2", computedHash: "h2" },
    ];

    const changeEntries = downloads
      .map((d) => shouldIncludeInChangeReport({ ...d, existingResourceIds, previousHashes }))
      .filter((r) => r.include);

    expect(changeEntries).toHaveLength(2);
    expect(changeEntries.every((e) => e.isNew)).toBe(true);
  });

  it("empty computedHash (url-txt items) does not suppress the entry on first download", () => {
    // url-txt items don't go through atomicWrite so computedHash = ""
    // On first download they should still appear as new
    const result = shouldIncludeInChangeReport({
      resourceId: "url-1",
      computedHash: "",
      existingResourceIds: new Set(),
      previousHashes: new Map(),
    });
    expect(result.include).toBe(true);
    expect(result.isNew).toBe(true);
  });

  it("empty computedHash on re-fetch does not hide the entry when no prev hash exists", () => {
    // url-txt re-fetched: computedHash still "" (no atomicWrite), prev hash also ""
    // contentChanged = isNew || !prevHash || ... → !prevHash is true → include
    const result = shouldIncludeInChangeReport({
      resourceId: "url-1",
      computedHash: "",
      existingResourceIds: new Set(["url-1"]),
      previousHashes: new Map(), // no hash stored for url items
    });
    expect(result.include).toBe(true);
  });
});
