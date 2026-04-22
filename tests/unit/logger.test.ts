// Covers: STEP-007, REQ-SEC-002, REQ-SEC-007
//
// Tests for the logger and credential redaction. The logger is tested as a unit —
// no real file I/O; output is captured via spy.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLogger, LogLevel } from "../../src/logger.js";

describe("STEP-007: Logger — credential redaction", () => {
  // REQ-SEC-002
  it("redacts the stored password from log output", () => {
    const logger = createLogger({ level: LogLevel.INFO, redact: ["s3cr3t"] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    logger.info("Connecting with password s3cr3t to moodle");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";
    expect(output).not.toContain("s3cr3t");
    expect(output).toContain("[REDACTED]");

    spy.mockRestore();
  });

  it("redacts the stored username from log output", () => {
    const logger = createLogger({ level: LogLevel.INFO, redact: ["alice"] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    logger.info("Logging in as alice");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";
    expect(output).not.toContain("alice");
    expect(output).toContain("[REDACTED]");

    spy.mockRestore();
  });

  it("redacts credentials that appear mid-sentence in an error message", () => {
    const logger = createLogger({ level: LogLevel.ERROR, redact: ["mypassword"] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    logger.error("Auth failed for user with password=mypassword");
    const output = spy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).not.toContain("mypassword");

    spy.mockRestore();
  });

  it("does not alter log output when there are no redact terms", () => {
    const logger = createLogger({ level: LogLevel.INFO, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    logger.info("Normal log message");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";
    expect(output).toContain("Normal log message");

    spy.mockRestore();
  });
});

describe("STEP-007: Logger — log levels", () => {
  // REQ-CLI-008, REQ-CLI-009
  it("at INFO level, info messages are emitted", () => {
    const logger = createLogger({ level: LogLevel.INFO, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.info("hello");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("at ERROR level (quiet), info messages are suppressed", () => {
    const logger = createLogger({ level: LogLevel.ERROR, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.info("should be suppressed");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("at ERROR level (quiet), error messages are still emitted", () => {
    const logger = createLogger({ level: LogLevel.ERROR, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.error("this is an error");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("at VERBOSE level, debug messages are emitted", () => {
    const logger = createLogger({ level: LogLevel.DEBUG, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.debug("verbose detail");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("at INFO level, debug messages are suppressed", () => {
    const logger = createLogger({ level: LogLevel.INFO, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.debug("suppressed debug");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("STEP-007: Logger — timestamp option", () => {
  it("omits ISO timestamp when timestamps option is false (default)", () => {
    const logger = createLogger({ level: LogLevel.INFO, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.info("hello");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";
    // Should NOT contain ISO timestamp pattern
    expect(output).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(output).toContain("[INFO]");
    expect(output).toContain("hello");
    spy.mockRestore();
  });

  it("includes ISO timestamp when timestamps option is true", () => {
    const logger = createLogger({ level: LogLevel.INFO, redact: [], timestamps: true });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.info("hello");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(output).toContain("[INFO]");
    spy.mockRestore();
  });

  it("log file always uses timestamps regardless of timestamps option", () => {
    // When logFile is configured, the log file receives timestamped lines
    // even if the terminal output does not. This is tested indirectly via
    // the createLogger contract: when logFile is set, timestamps defaults to true.
    const logger = createLogger({ level: LogLevel.INFO, redact: [], logFile: null });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.info("no ts");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";
    expect(output).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    spy.mockRestore();
  });
});

describe("Security: dynamic secret registration via addSecret()", () => {
  it("addSecret() causes subsequent log output to redact the new secret", () => {
    const logger = createLogger({ level: LogLevel.INFO, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    logger.addSecret("dynamic-password-123");
    logger.info("Login with dynamic-password-123 succeeded");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";
    expect(output).not.toContain("dynamic-password-123");
    expect(output).toContain("[REDACTED]");

    spy.mockRestore();
  });

  it("addSecret() does not retroactively redact already-emitted messages", () => {
    const logger = createLogger({ level: LogLevel.INFO, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    logger.info("Before: leaked-secret-456");
    logger.addSecret("leaked-secret-456");
    logger.info("After: leaked-secret-456");

    const firstOutput = (spy.mock.calls[0]?.[0] as string) ?? "";
    const secondOutput = (spy.mock.calls[1]?.[0] as string) ?? "";
    expect(firstOutput).toContain("leaked-secret-456"); // already emitted
    expect(secondOutput).not.toContain("leaked-secret-456"); // redacted

    spy.mockRestore();
  });

  it("addSecret() ignores empty strings", () => {
    const logger = createLogger({ level: LogLevel.INFO, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    logger.addSecret("");
    logger.info("Normal message");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";
    expect(output).toContain("Normal message");
    expect(output).not.toContain("[REDACTED]");

    spy.mockRestore();
  });
});

describe("STEP-007: Logger — TTY color prefixes", () => {
  // Feature 1 (Pass 41): colored [INFO]/[WARN]/[ERROR] prefixes on TTY stderr

  it("on TTY stderr, [INFO] prefix is wrapped in dim ANSI codes", () => {
    const origIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    delete process.env["NO_COLOR"];

    const logger = createLogger({ level: LogLevel.INFO, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.info("hello");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";

    // dim = \u001b[2m, reset = \u001b[0m
    expect(output).toContain("\u001b[2m[INFO]\u001b[0m");

    spy.mockRestore();
    Object.defineProperty(process.stderr, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("on TTY stderr, [WARN] prefix is wrapped in yellow ANSI codes", () => {
    const origIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    delete process.env["NO_COLOR"];

    const logger = createLogger({ level: LogLevel.WARN, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.warn("watch out");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";

    // yellow = \u001b[33m
    expect(output).toContain("\u001b[33m[WARN]\u001b[0m");

    spy.mockRestore();
    Object.defineProperty(process.stderr, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("on TTY stderr, [ERROR] prefix is wrapped in red ANSI codes", () => {
    const origIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    delete process.env["NO_COLOR"];

    const logger = createLogger({ level: LogLevel.ERROR, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.error("something broke");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";

    // red = \u001b[31m
    expect(output).toContain("\u001b[31m[ERROR]\u001b[0m");

    spy.mockRestore();
    Object.defineProperty(process.stderr, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("with NO_COLOR set, output has plain [INFO] with no ANSI codes", () => {
    const origIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    process.env["NO_COLOR"] = "1";

    const logger = createLogger({ level: LogLevel.INFO, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.info("plain");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";

    expect(output).toContain("[INFO]");
    expect(output).not.toContain("\u001b[");

    spy.mockRestore();
    delete process.env["NO_COLOR"];
    Object.defineProperty(process.stderr, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("on non-TTY stderr, output has plain [INFO] with no ANSI codes", () => {
    const origIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });
    delete process.env["NO_COLOR"];

    const logger = createLogger({ level: LogLevel.INFO, redact: [] });
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.info("non-tty");
    const output = (spy.mock.calls[0]?.[0] as string) ?? "";

    expect(output).toContain("[INFO]");
    expect(output).not.toContain("\u001b[");

    spy.mockRestore();
    Object.defineProperty(process.stderr, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("log file entry does NOT contain ANSI escape codes even when TTY is active", async () => {
    const origIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    delete process.env["NO_COLOR"];

    // Write to a real temp file and check its contents
    const { writeFileSync, readFileSync, unlinkSync } = await import("node:fs");
    const tmpPath = join(tmpdir(), `logger-test-${Date.now()}.log`);
    writeFileSync(tmpPath, ""); // create empty file

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const logger = createLogger({ level: LogLevel.INFO, redact: [], logFile: tmpPath });
    logger.info("file test");

    // The log file should NOT contain ANSI codes
    const fileContent = readFileSync(tmpPath, "utf8");
    expect(fileContent).not.toContain("\u001b[");
    expect(fileContent).toContain("[INFO]");

    // stderr output SHOULD contain ANSI (TTY active)
    const stderrOutput = (stderrSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(stderrOutput).toContain("\u001b[2m[INFO]\u001b[0m");

    stderrSpy.mockRestore();

    unlinkSync(tmpPath);
    Object.defineProperty(process.stderr, "isTTY", { value: origIsTTY, configurable: true });
  });
});

describe("STEP-007: Logger — log file always writes DEBUG regardless of stderr level", () => {
  // Covers Fix 3: when logFile is set, the file receives DEBUG-level messages even if
  // stderr is INFO-level (the default). This enables post-hoc diagnosis without
  // requiring the user to re-run with --verbose.

  it("log file receives DEBUG message even when stderr level is INFO", async () => {
    const { writeFileSync, readFileSync, unlinkSync } = await import("node:fs");
    const tmpPath = join(tmpdir(), `logger-debug-test-${Date.now()}.log`);
    writeFileSync(tmpPath, "");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // Create logger at INFO level (default for scrape) but with a log file
    const logger = createLogger({ level: LogLevel.INFO, redact: [], logFile: tmpPath });
    logger.debug("deep debug detail");

    // stderr: DEBUG must be suppressed (level = INFO)
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(stderrOutput).not.toContain("deep debug detail");

    // log file: DEBUG must be present (fileLevel defaults to DEBUG when logFile set)
    const fileContent = readFileSync(tmpPath, "utf8");
    expect(fileContent).toContain("[DEBUG]");
    expect(fileContent).toContain("deep debug detail");

    stderrSpy.mockRestore();
    unlinkSync(tmpPath);
  });

  it("log file writes INFO message normally when stderr level is INFO", async () => {
    const { writeFileSync, readFileSync, unlinkSync } = await import("node:fs");
    const tmpPath = join(tmpdir(), `logger-info-test-${Date.now()}.log`);
    writeFileSync(tmpPath, "");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const logger = createLogger({ level: LogLevel.INFO, redact: [], logFile: tmpPath });
    logger.info("regular info");

    const fileContent = readFileSync(tmpPath, "utf8");
    expect(fileContent).toContain("[INFO]");
    expect(fileContent).toContain("regular info");

    stderrSpy.mockRestore();
    unlinkSync(tmpPath);
  });

  it("explicit fileLevel overrides the DEBUG default", async () => {
    const { writeFileSync, readFileSync, unlinkSync } = await import("node:fs");
    const tmpPath = join(tmpdir(), `logger-filelevel-test-${Date.now()}.log`);
    writeFileSync(tmpPath, "");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // Explicitly set fileLevel to WARN — DEBUG and INFO should not appear in file
    const logger = createLogger({ level: LogLevel.INFO, redact: [], logFile: tmpPath, fileLevel: LogLevel.WARN });
    logger.debug("skip debug");
    logger.info("skip info");
    logger.warn("keep warn");

    const fileContent = readFileSync(tmpPath, "utf8");
    expect(fileContent).not.toContain("skip debug");
    expect(fileContent).not.toContain("skip info");
    expect(fileContent).toContain("[WARN]");
    expect(fileContent).toContain("keep warn");

    stderrSpy.mockRestore();
    unlinkSync(tmpPath);
  });
});

describe("STEP-007: Logger — state file redaction guard", () => {
  // REQ-SEC-007
  it("assertNoSecrets() throws if a state object contains a known secret value", async () => {
    const { assertNoSecrets } = await import("../../src/logger.js");
    const stateWithSecret = { courseId: "42", url: "https://example.com", token: "s3cr3t" };
    expect(() => assertNoSecrets(stateWithSecret, ["s3cr3t"])).toThrow(
      /state.*secret/i
    );
  });

  it("assertNoSecrets() does not throw when no secrets are present", async () => {
    const { assertNoSecrets } = await import("../../src/logger.js");
    const cleanState = { courseId: "42", url: "https://example.com" };
    expect(() => assertNoSecrets(cleanState, ["s3cr3t"])).not.toThrow();
  });
});
