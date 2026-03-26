// Covers: STEP-007, REQ-SEC-002, REQ-SEC-007
//
// Tests for the logger and credential redaction. The logger is tested as a unit —
// no real file I/O; output is captured via spy.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
