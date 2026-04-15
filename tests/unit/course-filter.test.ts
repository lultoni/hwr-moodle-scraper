// Tests for src/scraper/course-filter.ts

import { describe, it, expect } from "vitest";
import { matchCourses } from "../../src/scraper/course-filter.js";
import type { State } from "../../src/sync/state.js";

function makeState(courses: Record<string, string>): State {
  return {
    version: 1,
    lastSyncAt: new Date().toISOString(),
    courses: Object.fromEntries(
      Object.entries(courses).map(([id, name]) => [id, { name, sections: {} }]),
    ),
  };
}

const STATE = makeState({
  "12345": "WI2032 Objektorientierte Programmierung",
  "67890": "WI2041 Datenbanken",
  "11111": "WI2099 Softwareentwicklung und Datenbanken",
  "22222": "WI1010 Mathematik 1",
});

describe("matchCourses()", () => {
  it("matches a single keyword by substring (case-insensitive)", () => {
    const { ids, unmatched } = matchCourses("datenbank", STATE);
    expect(ids).toContain(67890);
    expect(unmatched).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const { ids } = matchCourses("DATENBANK", STATE);
    expect(ids).toContain(67890);
  });

  it("returns all courses matching a token (one token → multiple courses)", () => {
    const { ids, unmatched } = matchCourses("datenbank", STATE);
    // "Datenbanken" and "Softwareentwicklung und Datenbanken" both match
    expect(ids).toContain(67890);
    expect(ids).toContain(11111);
    expect(unmatched).toHaveLength(0);
  });

  it("returns union of matches for multiple tokens", () => {
    const { ids, unmatched } = matchCourses("Mathematik, OOP", STATE);
    expect(ids).toContain(22222); // Mathematik
    expect(unmatched).toContain("OOP"); // no match
    expect(unmatched).not.toContain("Mathematik");
  });

  it("deduplicates IDs when multiple tokens match the same course", () => {
    // "Datenbank" and "WI2041" both match course 67890
    const { ids } = matchCourses("Datenbank, WI2041", STATE);
    const count67890 = ids.filter((id) => id === 67890).length;
    expect(count67890).toBe(1);
  });

  it("returns unmatched tokens when nothing found", () => {
    const { ids, unmatched } = matchCourses("Quantenphysik", STATE);
    expect(ids).toHaveLength(0);
    expect(unmatched).toContain("Quantenphysik");
  });

  it("returns empty result for empty keywords string", () => {
    const { ids, unmatched } = matchCourses("", STATE);
    expect(ids).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
  });

  it("returns empty result for whitespace-only string", () => {
    const { ids, unmatched } = matchCourses("   ", STATE);
    expect(ids).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
  });

  it("handles null state — all tokens unmatched", () => {
    const { ids, unmatched } = matchCourses("Datenbank", null);
    expect(ids).toHaveLength(0);
    expect(unmatched).toContain("Datenbank");
  });

  it("handles empty state courses — all tokens unmatched", () => {
    const empty = makeState({});
    const { ids, unmatched } = matchCourses("Datenbank", empty);
    expect(ids).toHaveLength(0);
    expect(unmatched).toContain("Datenbank");
  });

  it("trims whitespace around comma-separated tokens", () => {
    const { ids } = matchCourses("  Mathematik  ,  OOP  ", STATE);
    expect(ids).toContain(22222);
  });

  it("skips empty tokens from double-commas", () => {
    const { ids, unmatched } = matchCourses("Mathematik,,Datenbank", STATE);
    expect(ids).toContain(22222);
    expect(ids).toContain(67890);
    expect(unmatched).toHaveLength(0);
  });

  it("matches course module code prefix", () => {
    const { ids } = matchCourses("WI1010", STATE);
    expect(ids).toContain(22222);
  });
});
