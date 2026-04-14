// Covers: STEP-011, REQ-FS-002, REQ-FS-005, REQ-FS-006, REQ-FS-008
//
// Tests for the filesystem output structure: folder hierarchy, atomic writes,
// partial file cleanup on startup, and disk space pre-check.
// Uses memfs for in-memory filesystem isolation.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

// We test against the real filesystem in a temp dir (memfs for pure unit tests,
// real temp dir for integration-like fs tests)

import { buildOutputPath, atomicWrite, cleanPartialFiles, checkDiskSpace, computeFileHash } from "../../src/fs/output.js";

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

  it("returns SHA-256 hex digest of written content", async () => {
    const target = join(tmpDir, "hashed.txt");
    const content = Buffer.from("test content for hashing");
    const expectedHash = createHash("sha256").update(content).digest("hex");

    const { hash } = await atomicWrite(target, content);

    expect(hash).toBe(expectedHash);
    expect(hash).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it("returned hash matches computeFileHash of the written file", async () => {
    const target = join(tmpDir, "check.pdf");
    const content = Buffer.from("some binary content \x00\x01\x02");

    const { hash: writeHash } = await atomicWrite(target, content);
    const diskHash = computeFileHash(target);

    expect(writeHash).toBe(diskHash);
  });
});

describe("STEP-011: computeFileHash", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-hash-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns SHA-256 of an existing file", () => {
    const target = join(tmpDir, "file.txt");
    const content = Buffer.from("known content");
    writeFileSync(target, content);
    const expected = createHash("sha256").update(content).digest("hex");
    expect(computeFileHash(target)).toBe(expected);
  });

  it("returns empty string for a non-existent file (no throw)", () => {
    expect(computeFileHash(join(tmpDir, "does-not-exist.pdf"))).toBe("");
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

describe("Security: checkDiskSpace — no command injection", () => {
  it("handles directory names containing shell metacharacters safely", async () => {
    // If command injection existed, this would execute the subshell
    // With statfs, it simply gets ENOENT for a non-existent path
    await expect(
      checkDiskSpace('/tmp/$(echo pwned)', { minFreeMb: 1 })
    ).resolves.toBeUndefined(); // silently skips if path doesn't exist
  });

  it("handles directory names with backtick injection safely", async () => {
    await expect(
      checkDiskSpace('/tmp/`whoami`', { minFreeMb: 1 })
    ).resolves.toBeUndefined();
  });
});

describe("Security: buildOutputPath — semesterDir sanitisation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-semester-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sanitises semesterDir to prevent path traversal via '..'", async () => {
    const outPath = await buildOutputPath({
      outputDir: tmpDir,
      semesterDir: "../../etc",
      courseName: "Course",
      sectionName: "Section",
      filename: "file.txt",
    });
    // The result must stay within tmpDir — sanitiseFilename strips leading dots
    // and replaces path separators, so traversal is impossible
    expect(outPath.startsWith(tmpDir)).toBe(true);
    // No actual path separator followed by ".." should appear
    expect(outPath).not.toMatch(/[/\\]\.\.[/\\]/);
  });

  it("strips illegal characters from semesterDir", async () => {
    const outPath = await buildOutputPath({
      outputDir: tmpDir,
      semesterDir: 'Semester:3/"test"',
      courseName: "Course",
      sectionName: "Section",
      filename: "file.txt",
    });
    expect(outPath).not.toContain(":");
    expect(outPath).not.toContain('"');
  });
});

describe("Security: atomicWrite — file permissions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-perm-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("written files have permissions 0o600 (owner read/write only)", async () => {
    const { statSync } = await import("node:fs");
    const target = join(tmpDir, "private.pdf");
    await atomicWrite(target, Buffer.from("sensitive content"));

    const mode = statSync(target).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
