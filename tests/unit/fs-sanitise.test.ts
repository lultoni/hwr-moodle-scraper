// Covers: STEP-003, REQ-FS-003, REQ-FS-004
//
// Tests for filename sanitisation (pure function) and collision resolution.
// These are pure unit tests — no I/O.

import { describe, it, expect } from "vitest";
import { sanitiseFilename, resolveCollision } from "../../src/fs/sanitise.js";

describe("STEP-003: Filename sanitisation", () => {
  // REQ-FS-003 — illegal characters replaced
  it("replaces forward slash with underscore", () => {
    expect(sanitiseFilename("foo/bar.pdf")).toBe("foo_bar.pdf");
  });

  it("replaces backslash with underscore", () => {
    expect(sanitiseFilename("foo\\bar.pdf")).toBe("foo_bar.pdf");
  });

  it("replaces colon with underscore", () => {
    expect(sanitiseFilename("report: final.pdf")).toBe("report_ final.pdf");
  });

  it("replaces all illegal chars: * ? \" < > |", () => {
    expect(sanitiseFilename('a*b?c"d<e>f|g')).toBe("a_b_c_d_e_f_g");
  });

  it("strips null bytes", () => {
    expect(sanitiseFilename("foo\x00bar")).toBe("foobar");
  });

  // REQ-FS-003 — leading/trailing whitespace and dots trimmed
  it("trims leading and trailing whitespace", () => {
    expect(sanitiseFilename("  hello.txt  ")).toBe("hello.txt");
  });

  it("trims leading and trailing dots", () => {
    expect(sanitiseFilename("...hidden...")).toBe("hidden");
  });

  // REQ-FS-003 — blank result falls back to 'unnamed'
  it("returns 'unnamed' for a blank input", () => {
    expect(sanitiseFilename("")).toBe("unnamed");
  });

  it("returns 'unnamed' for a string that is all illegal characters", () => {
    expect(sanitiseFilename("///")).toBe("unnamed");
  });

  it("returns 'unnamed' for whitespace-only input", () => {
    expect(sanitiseFilename("   ")).toBe("unnamed");
  });

  // REQ-FS-003 — max 255 bytes, preserving extension
  it("truncates a filename longer than 255 bytes, preserving extension", () => {
    const longName = "a".repeat(260) + ".pdf";
    const result = sanitiseFilename(longName);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(255);
    expect(result.endsWith(".pdf")).toBe(true);
  });

  it("truncates a filename with no extension to 255 bytes", () => {
    const longName = "a".repeat(300);
    const result = sanitiseFilename(longName);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(255);
  });

  it("is deterministic — same input always returns same output", () => {
    const input = "Lecture Notes: Week 1 / Introduction.pdf";
    expect(sanitiseFilename(input)).toBe(sanitiseFilename(input));
  });
});

describe("STEP-003: Collision resolution", () => {
  // REQ-FS-004
  it("returns the original filename when no collision exists", () => {
    expect(resolveCollision("report.pdf", new Set())).toBe("report.pdf");
  });

  it("appends _2 when original is taken", () => {
    expect(resolveCollision("report.pdf", new Set(["report.pdf"]))).toBe("report_2.pdf");
  });

  it("appends _3 when _2 is also taken", () => {
    const taken = new Set(["report.pdf", "report_2.pdf"]);
    expect(resolveCollision("report.pdf", taken)).toBe("report_3.pdf");
  });

  it("handles files with no extension", () => {
    expect(resolveCollision("README", new Set(["README"]))).toBe("README_2");
  });

  it("handles the 'unnamed' fallback with collision", () => {
    expect(resolveCollision("unnamed", new Set(["unnamed"]))).toBe("unnamed_2");
  });
});
