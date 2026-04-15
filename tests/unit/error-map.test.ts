// Covers: UC-26 — German Moodle error string translation
// Tests for the translateMoodleError utility.

import { describe, it, expect } from "vitest";
import { translateMoodleError } from "../../src/scraper/error-map.js";

describe("UC-26: translateMoodleError", () => {
  it("translates 'Ungültige Anmeldedaten' to English", () => {
    const result = translateMoodleError("Ungültige Anmeldedaten");
    expect(result).toContain("Invalid credentials");
    expect(result).toContain("Ungültige Anmeldedaten");
  });

  it("is case-insensitive", () => {
    const result = translateMoodleError("ungültige anmeldedaten");
    expect(result).toContain("Invalid credentials");
  });

  it("translates 'Sitzung abgelaufen' to English", () => {
    const result = translateMoodleError("Sitzung abgelaufen");
    expect(result).toContain("Session expired");
  });

  it("translates 'Keine Berechtigung' to English", () => {
    const result = translateMoodleError("Keine Berechtigung");
    expect(result).toContain("Access denied");
  });

  it("translates 'Wartungsmodus' to English", () => {
    const result = translateMoodleError("Wartungsmodus");
    expect(result).toContain("maintenance mode");
  });

  it("returns unknown strings unchanged", () => {
    const msg = "Some unknown Moodle message";
    expect(translateMoodleError(msg)).toBe(msg);
  });

  it("wraps translated message with raw string in parentheses", () => {
    const result = translateMoodleError("Ungültige Anmeldedaten");
    expect(result).toMatch(/\(Moodle: "Ungültige Anmeldedaten"\)/);
  });

  it("trims whitespace from input before matching", () => {
    const result = translateMoodleError("  Ungültige Anmeldedaten  ");
    expect(result).toContain("Invalid credentials");
  });
});
