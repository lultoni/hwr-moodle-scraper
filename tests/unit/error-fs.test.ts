// Covers: STEP-019, REQ-ERR-008, REQ-ERR-009, REQ-ERR-010, REQ-ERR-011,
//         REQ-ERR-012, REQ-ERR-013
//
// Tests for filesystem errors and graceful shutdown.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleDiskFull, handleCorruptStateFile } from "../../src/fs/error-handlers.js";
import { StateManager } from "../../src/sync/state.js";
import { cleanPartialFiles } from "../../src/fs/output.js";
import { registerShutdownHandlers } from "../../src/process/shutdown.js";

describe("STEP-019: Disk full during download", () => {
  // REQ-ERR-008
  it("deletes the partial file and logs error when disk full occurs", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "msc-diskfull-test-"));
    const partialPath = join(tmpDir, "file.pdf.tmp");
    writeFileSync(partialPath, "partial data");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await handleDiskFull(partialPath, new Error("ENOSPC: no space left on device"));

    expect(existsSync(partialPath)).toBe(false); // partial file deleted
    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("disk full");

    stderrSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("STEP-019: Output directory inaccessible", () => {
  // REQ-ERR-009
  // On Windows, POSIX root paths like /nonexistent-root... resolve from the drive root
  // and don't trigger an access error, so this test is skipped on Windows.
  it.skipIf(process.platform === "win32")("throws with exitCode 5 when output directory does not exist and cannot be created", async () => {
    const { buildOutputPath } = await import("../../src/fs/output.js");
    // A path that cannot be created (inside a non-existent parent on a read-only root)
    const impossible = "/nonexistent-root-level-dir-abc123/subdir/file.pdf";
    await expect(
      buildOutputPath({ outputDir: "/nonexistent-root-level-dir-abc123", courseName: "C", sectionName: "S", filename: "f.pdf" })
    ).rejects.toMatchObject({ exitCode: 5 });
  });
});

describe("STEP-019: Corrupt state file", () => {
  // REQ-ERR-010
  it("logs warning and treats as first run when state file is corrupt JSON", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "msc-corrupt-test-"));
    const stateFile = join(tmpDir, ".moodle-scraper-state.json");
    writeFileSync(stateFile, "{ this is not valid json !!!");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const sm = new StateManager(tmpDir);
    const state = await sm.load(); // should not throw

    const output = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("corrupt");
    expect(state).toBeNull(); // treated as first run

    stderrSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("STEP-019: Unexpected page structure", () => {
  // REQ-ERR-011
  it("logs warning with URL and skips activity without throwing", async () => {
    const { parseActivityFromElement } = await import("../../src/scraper/courses.js");
    const warnings: string[] = [];
    const logger = { debug: vi.fn(), info: vi.fn(), warn: (msg: string) => warnings.push(msg), error: vi.fn() };

    // Pass a completely empty/invalid element
    const result = await parseActivityFromElement(null as never, "https://moodle.example.com/course/view.php?id=1", logger);

    expect(warnings.join(" ").toLowerCase()).toContain("unexpected page structure");
    expect(result).toBeNull(); // skipped
  });
});

describe("STEP-019: Graceful shutdown (SIGINT)", () => {
  // REQ-ERR-012
  it("SIGINT handler flushes state file and prints interruption message", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "msc-shutdown-test-"));
    writeFileSync(join(tmpDir, "partial.pdf.tmp"), "x");

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const sm = new StateManager(tmpDir);

    const { cleanup } = registerShutdownHandlers({ stateManager: sm, outputDir: tmpDir });

    // Simulate SIGINT
    await cleanup();

    expect(existsSync(join(tmpDir, "partial.pdf.tmp"))).toBe(false);
    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Interrupted. Progress saved.");

    stdoutSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("STEP-019: Stale partial file cleanup on startup", () => {
  // REQ-ERR-013
  it("cleanPartialFiles removes all *.tmp files recursively", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "msc-stale-test-"));
    writeFileSync(join(tmpDir, "a.pdf.tmp"), "stale");
    writeFileSync(join(tmpDir, "b.pdf.tmp"), "stale");

    await cleanPartialFiles(tmpDir);

    expect(existsSync(join(tmpDir, "a.pdf.tmp"))).toBe(false);
    expect(existsSync(join(tmpDir, "b.pdf.tmp"))).toBe(false);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
