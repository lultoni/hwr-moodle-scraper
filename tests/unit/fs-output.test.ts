// Covers: STEP-011, REQ-FS-002, REQ-FS-005, REQ-FS-006, REQ-FS-008
//
// Tests for the filesystem output structure: folder hierarchy, atomic writes,
// partial file cleanup on startup, and disk space pre-check.
// Uses memfs for in-memory filesystem isolation.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We test against the real filesystem in a temp dir (memfs for pure unit tests,
// real temp dir for integration-like fs tests)

import { buildOutputPath, atomicWrite, cleanPartialFiles, checkDiskSpace } from "../../src/fs/output.js";

describe("STEP-011: Folder hierarchy", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-fs-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // REQ-FS-002
  it("creates <outputDir>/<CourseName>/<SectionName>/ with sanitised names", async () => {
    const outPath = await buildOutputPath({
      outputDir: tmpDir,
      courseName: "Macro 2024",
      sectionName: "Week 1",
      filename: "lecture.pdf",
    });
    expect(outPath).toMatch(/Macro_2024[/\\]Week_1[/\\]lecture\.pdf/);
  });

  it("creates intermediate directories on demand", async () => {
    const { existsSync } = await import("node:fs");
    const outPath = await buildOutputPath({
      outputDir: tmpDir,
      courseName: "Course A",
      sectionName: "Section B",
      filename: "file.txt",
    });
    const dir = outPath.replace(/[/\\][^/\\]+$/, "");
    expect(existsSync(dir)).toBe(true);
  });

  it("with semesterDir creates <outputDir>/<semesterDir>/<CourseName>/<SectionName>/", async () => {
    const { existsSync } = await import("node:fs");
    const outPath = await buildOutputPath({
      outputDir: tmpDir,
      semesterDir: "Semester_3",
      courseName: "Datenbanken",
      sectionName: "Einführung",
      filename: "lecture.pdf",
    });
    expect(outPath).toMatch(/Semester_3[/\\]Datenbanken[/\\]Einf.hrung[/\\]lecture\.pdf/);
    const dir = outPath.replace(/[/\\][^/\\]+$/, "");
    expect(existsSync(dir)).toBe(true);
  });

  it("without semesterDir behaves same as before (no extra level)", async () => {
    const outPath = await buildOutputPath({
      outputDir: tmpDir,
      courseName: "Datenbanken",
      sectionName: "Section 1",
      filename: "file.pdf",
    });
    // Should NOT contain a semester prefix
    const rel = outPath.replace(tmpDir, "");
    const parts = rel.split(/[/\\]/).filter(Boolean);
    // parts: [courseName, sectionName, filename] — exactly 3 levels
    expect(parts).toHaveLength(3);
  });
});

describe("STEP-011: Atomic file writes", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-atomic-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // REQ-FS-005
  it("write is atomic: final file appears at target path on success", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const target = join(tmpDir, "output.txt");
    const content = Buffer.from("hello world");

    await atomicWrite(target, content);

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target)).toEqual(content);
  });

  it("no .tmp file remains after successful write", async () => {
    const { readdirSync } = await import("node:fs");
    const target = join(tmpDir, "output.txt");
    await atomicWrite(target, Buffer.from("data"));

    const tmpFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("STEP-011: Partial file cleanup on startup", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-cleanup-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // REQ-FS-006
  it("deletes all *.tmp files in the output dir tree on startup", async () => {
    const { writeFileSync, existsSync } = await import("node:fs");
    const tmpFile1 = join(tmpDir, "partial1.pdf.tmp");
    const tmpFile2 = join(tmpDir, "partial2.pdf.tmp");
    const realFile = join(tmpDir, "real.pdf");
    writeFileSync(tmpFile1, "partial");
    writeFileSync(tmpFile2, "partial");
    writeFileSync(realFile, "complete");

    await cleanPartialFiles(tmpDir);

    expect(existsSync(tmpFile1)).toBe(false);
    expect(existsSync(tmpFile2)).toBe(false);
    expect(existsSync(realFile)).toBe(true); // real file untouched
  });

  it("logs each deleted .tmp file at warn level", async () => {
    const { writeFileSync } = await import("node:fs");
    const { createLogger, LogLevel } = await import("../../src/logger.js");
    const logger = createLogger({ level: LogLevel.WARN, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    writeFileSync(join(tmpDir, "file.pdf.tmp"), "x");
    await cleanPartialFiles(tmpDir, logger);

    const output = spy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain(".tmp");
    spy.mockRestore();
  });
});

describe("STEP-011: Disk space pre-check", () => {
  // REQ-FS-008
  it("throws with exitCode 5 when available space < minFreeMb", async () => {
    // Mock statvfs to return insufficient space
    await expect(
      checkDiskSpace("/tmp", { minFreeMb: 999_999_999 }) // impossibly large threshold
    ).rejects.toMatchObject({ exitCode: 5 });
  });

  it("resolves when available space >= minFreeMb", async () => {
    // 1 MB threshold — should always pass on any real machine
    await expect(checkDiskSpace("/tmp", { minFreeMb: 1 })).resolves.toBeUndefined();
  });
});
