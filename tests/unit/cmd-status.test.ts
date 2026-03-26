// Covers: STEP-021, REQ-CLI-006, REQ-CLI-012, REQ-CLI-016
//
// Tests for the 'status' command and log file output.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/sync/state.js", () => ({
  StateManager: vi.fn(),
}));

import { runStatus } from "../../src/commands/status.js";
import { StateManager } from "../../src/sync/state.js";

describe("STEP-021: status command", () => {
  // REQ-CLI-006
  it("prints last sync time, courses count, files count, orphaned count", async () => {
    vi.mocked(StateManager).mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        version: 1,
        lastSyncAt: "2026-03-26T10:00:00.000Z",
        courses: {
          "1": { name: "Macro", sections: { "s1": { files: { "r1": { status: "ok" }, "r2": { status: "orphan" } } } } },
        },
      }),
      save: vi.fn(),
      statePath: "/tmp/test/.moodle-scraper-state.json",
    } as never));

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runStatus({ outputDir: "/tmp/test" });

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("Last sync:");
    expect(output).toContain("Courses: 1");
    expect(output).toContain("Files: 2");
    expect(output).toContain("Orphaned: 1");

    stdoutSpy.mockRestore();
  });

  // REQ-CLI-006 — no state file
  it("prints 'No sync history' when state file does not exist", async () => {
    vi.mocked(StateManager).mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn(),
      statePath: "/tmp/test/.moodle-scraper-state.json",
    } as never));

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runStatus({ outputDir: "/tmp/test" });

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("No sync history");
    expect(output).toContain("scrape");

    stdoutSpy.mockRestore();
  });

  // REQ-CLI-016 — --issues lists orphaned files
  it("--issues lists each orphaned file with path and last known URL", async () => {
    vi.mocked(StateManager).mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({
        version: 1,
        lastSyncAt: "2026-03-26T10:00:00.000Z",
        courses: {
          "1": { name: "Macro", sections: { "s1": { files: {
            "r1": { status: "orphan", localPath: "/out/macro/file.pdf", url: "https://moodle.example.com/r/r1" },
          } } } },
        },
      }),
      save: vi.fn(),
      statePath: "/tmp/test/.moodle-scraper-state.json",
    } as never));

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runStatus({ outputDir: "/tmp/test", showIssues: true });

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("/out/macro/file.pdf");
    expect(output).toContain("https://moodle.example.com/r/r1");

    stdoutSpy.mockRestore();
  });
});

describe("STEP-021: Log file output", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-log-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // REQ-CLI-012
  it("--log-file writes log output to file in addition to stderr", async () => {
    const { createLogger, LogLevel } = await import("../../src/logger.js");
    const logPath = join(tmpDir, "msc.log");
    const logger = createLogger({ level: LogLevel.INFO, redact: [], logFile: logPath });

    logger.info("test log entry");

    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf8");
    expect(content).toContain("test log entry");
  });

  it("log file is created with permissions 0600", async () => {
    const { createLogger, LogLevel } = await import("../../src/logger.js");
    const logPath = join(tmpDir, "msc.log");
    const logger = createLogger({ level: LogLevel.INFO, redact: [], logFile: logPath });
    logger.info("x");

    const st = statSync(logPath);
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("log file entries include timestamps", async () => {
    const { createLogger, LogLevel } = await import("../../src/logger.js");
    const logPath = join(tmpDir, "ts.log");
    const logger = createLogger({ level: LogLevel.INFO, redact: [], logFile: logPath });
    logger.info("timestamped");

    const content = readFileSync(logPath, "utf8");
    // ISO timestamp pattern: 2026-03-26T...
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
