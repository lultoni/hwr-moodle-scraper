// Tests for filterSidecars() — sidecar deduplication / short-description consolidation.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import TurndownService from "turndown";
import { filterSidecars, type SidecarItem } from "../../src/scraper/sidecar-filter.js";

function makeSidecar(overrides: Partial<SidecarItem> & { destPath: string }): SidecarItem {
  return {
    item: { resourceId: "res1", courseId: 1, url: "https://example.com" },
    strategy: "description-md",
    label: "My Activity",
    description: "<p>Some long description text that is definitely longer than sixty characters.</p>",
    activityType: "resource",
    isSidecar: true,
    ...overrides,
  };
}

describe("filterSidecars()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-sidecar-filter-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Test 1: exact duplicate in existing disk file ────────────────────────
  it("suppresses sidecar when description content appears in an existing .md file in the same dir", () => {
    const dir = join(tmpDir, "Section");
    mkdirSync(dir);
    const descText = "This is a specific description that will appear in the other file.";
    // Write an existing .md that already contains the description text
    writeFileSync(join(dir, "OtherActivity.md"), `# OtherActivity\n\n${descText}\n\nMore content here.`);

    const sidecar = makeSidecar({
      destPath: join(dir, "MyActivity.description.md"),
      description: `<p>${descText}</p>`,
    });

    const result = filterSidecars([sidecar], TurndownService);
    expect(result.filteredItems).toHaveLength(0);
    expect(result.suppressedCount).toBe(1);
    expect(result.consolidatedCount).toBe(0);
    expect(result.beschreibungenFiles).toHaveLength(0);
  });

  // ── Test 2: exact duplicate in same batch ────────────────────────────────
  it("suppresses second sidecar when two sidecars in same dir have identical descriptions", () => {
    const dir = join(tmpDir, "Section");
    mkdirSync(dir);
    const descHtml = "<p>Identical description text that is over sixty characters long.</p>";

    const sidecarA = makeSidecar({
      destPath: join(dir, "ActivityA.description.md"),
      label: "Activity A",
      item: { resourceId: "resA", courseId: 1 },
      description: descHtml,
    });
    const sidecarB = makeSidecar({
      destPath: join(dir, "ActivityB.description.md"),
      label: "Activity B",
      item: { resourceId: "resB", courseId: 1 },
      description: descHtml,
    });

    const result = filterSidecars([sidecarA, sidecarB], TurndownService);
    // First one kept, second suppressed
    expect(result.filteredItems).toHaveLength(1);
    expect(result.filteredItems[0]!.label).toBe("Activity A");
    expect(result.suppressedCount).toBe(1);
    expect(result.consolidatedCount).toBe(0);
  });

  // ── Test 3: short consolidation ≥2 in same dir ──────────────────────────
  it("consolidates ≥2 short descriptions (≤60 chars) in same dir into _Beschreibungen.md", () => {
    const dir = join(tmpDir, "Section");
    mkdirSync(dir);

    const sidecarA = makeSidecar({
      destPath: join(dir, "FiMa Skript.description.md"),
      label: "FiMa Skript",
      item: { resourceId: "resA", courseId: 1 },
      description: "<p>Zinssatz</p>",
    });
    const sidecarB = makeSidecar({
      destPath: join(dir, "FimaAufgaben.description.md"),
      label: "FimaAufgaben",
      item: { resourceId: "resB", courseId: 1 },
      description: "<p>Aufgabe 4/10 korrigiert</p>",
    });

    const result = filterSidecars([sidecarA, sidecarB], TurndownService);
    expect(result.filteredItems).toHaveLength(0);
    expect(result.consolidatedCount).toBe(2);
    expect(result.suppressedCount).toBe(0);
    expect(result.beschreibungenFiles).toHaveLength(1);

    const bf = result.beschreibungenFiles[0]!;
    expect(bf.path).toBe(join(dir, "_Beschreibungen.md"));
    expect(bf.content).toContain("# Beschreibungen");
    expect(bf.content).toContain("**FiMa Skript:** Zinssatz");
    expect(bf.content).toContain("**FimaAufgaben:** Aufgabe 4/10 korrigiert");
  });

  // ── Test 4: lone short description NOT consolidated ───────────────────────
  it("keeps a lone short description (≤60 chars) as a normal sidecar when it is the only one in the dir", () => {
    const dir = join(tmpDir, "Section");
    mkdirSync(dir);

    const sidecar = makeSidecar({
      destPath: join(dir, "FiMa Skript.description.md"),
      label: "FiMa Skript",
      description: "<p>Zinssatz</p>",
    });

    const result = filterSidecars([sidecar], TurndownService);
    expect(result.filteredItems).toHaveLength(1);
    expect(result.filteredItems[0]!.label).toBe("FiMa Skript");
    expect(result.beschreibungenFiles).toHaveLength(0);
    expect(result.consolidatedCount).toBe(0);
    expect(result.suppressedCount).toBe(0);
  });

  // ── Test 5: long unique sidecar passes through unchanged ─────────────────
  it("passes a long unique sidecar through unchanged when dir is empty", () => {
    const dir = join(tmpDir, "Section");
    mkdirSync(dir);

    const sidecar = makeSidecar({
      destPath: join(dir, "LectureMaterial.description.md"),
      label: "Lecture Material",
      description: "<p>This is a very specific and unique description that is more than sixty characters long.</p>",
    });

    const result = filterSidecars([sidecar], TurndownService);
    expect(result.filteredItems).toHaveLength(1);
    expect(result.filteredItems[0]).toStrictEqual(sidecar);
    expect(result.suppressedCount).toBe(0);
    expect(result.consolidatedCount).toBe(0);
    expect(result.beschreibungenFiles).toHaveLength(0);
  });

  // ── Test 6: non-sidecar items always pass through ────────────────────────
  it("always passes non-sidecar items through, even when sidecars are suppressed", () => {
    const dir = join(tmpDir, "Section");
    mkdirSync(dir);

    const pageMdItem: SidecarItem = {
      item: { resourceId: "res-page", courseId: 1 },
      destPath: join(dir, "Forum.md"),
      strategy: "page-md",
      label: "Forum",
      activityType: "forum",
      isSidecar: false,
    };
    const sidecar = makeSidecar({
      destPath: join(dir, "Forum.description.md"),
      description: "<p>Zinssatz</p>", // short — consolidation bucket
    });

    const result = filterSidecars([pageMdItem, sidecar], TurndownService);
    // page-md always present
    expect(result.filteredItems.some((i) => i.strategy === "page-md")).toBe(true);
  });

  // ── Test 7: NFC normalisation ────────────────────────────────────────────
  it("detects disk duplicates even when directory was created with NFD path on macOS", () => {
    // Create dir with NFC name (simulates what the scraper writes)
    const nfcName = "Prüfungsordnung"; // NFC ü
    const nfdName = "Pru\u0308fungsordnung"; // NFD ü (decomposed)
    const nfcDir = join(tmpDir, nfcName);
    mkdirSync(nfcDir);

    const descText = "This is a description that should be found in the disk scan even with NFD paths.";
    // Write a file into the dir (filesystem stores NFD on macOS, NFC on Linux — test uses real fs)
    writeFileSync(join(nfcDir, "Existing.md"), `# Existing\n\n${descText}\n`);

    // Sidecar destPath uses NFC
    const sidecar = makeSidecar({
      destPath: join(tmpDir, nfcName, "NewActivity.description.md"),
      description: `<p>${descText}</p>`,
    });

    const result = filterSidecars([sidecar], TurndownService);
    // Should be suppressed — disk scan must find the content regardless of NFC/NFD dir name
    expect(result.suppressedCount).toBe(1);
    expect(result.filteredItems).toHaveLength(0);
  });

  // ── Test 8: short descs in different dirs not consolidated together ───────
  it("does not consolidate short descriptions from different directories together", () => {
    const dirA = join(tmpDir, "SectionA");
    const dirB = join(tmpDir, "SectionB");
    mkdirSync(dirA);
    mkdirSync(dirB);

    const sidecarA = makeSidecar({
      destPath: join(dirA, "FileA.description.md"),
      label: "FileA",
      item: { resourceId: "resA", courseId: 1 },
      description: "<p>Zinssatz</p>",
    });
    const sidecarB = makeSidecar({
      destPath: join(dirB, "FileB.description.md"),
      label: "FileB",
      item: { resourceId: "resB", courseId: 1 },
      description: "<p>Aufgabe</p>",
    });

    const result = filterSidecars([sidecarA, sidecarB], TurndownService);
    // Each dir has only 1 short desc — both kept individually
    expect(result.filteredItems).toHaveLength(2);
    expect(result.beschreibungenFiles).toHaveLength(0);
    expect(result.consolidatedCount).toBe(0);
    expect(result.suppressedCount).toBe(0);
  });
});
