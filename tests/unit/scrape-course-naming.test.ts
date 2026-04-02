// Covers: REQ-CLI-002 (course structure), REQ-FS-002 (path building)
//
// Tests for parseCourseNameParts — extracts semester directory and short human name
// from raw Moodle course names using the HWR WI module numbering scheme.

import { describe, it, expect } from "vitest";
import { parseCourseNameParts, buildCourseShortPaths } from "../../src/scraper/course-naming.js";

describe("parseCourseNameParts — semester detection", () => {
  it("WI2032 → Semester_3, shortName Datenbanken", () => {
    const r = parseCourseNameParts("WI-22/2-M13-WI2032-F01-WiSe-2025-51413 WI24A Datenbanken WiSe-2025");
    expect(r.semesterDir).toBe("Semester_3");
    expect(r.shortName).toBe("Datenbanken");
  });

  it("WI1011 → Semester_1, shortName Betriebswirtschaftliche Grundlagen", () => {
    const r = parseCourseNameParts("WI-M01-WI1011-F01-WiSe-2024-35267 WI24A Betriebswirtschaftliche Grundlagen  WiSe-2024");
    expect(r.semesterDir).toBe("Semester_1");
    expect(r.shortName).toBe("Betriebswirtschaftliche Grundlagen");
  });

  it("WI1012 → Semester_1, shortName Finanzbuchführung", () => {
    const r = parseCourseNameParts("WI-M02-WI1012-F01-WiSe-2024-35270 WI24A Finanzbuchführung  WiSe-2024");
    expect(r.semesterDir).toBe("Semester_1");
    expect(r.shortName).toBe("Finanzbuchführung");
  });

  it("WI2013 → Semester_1, shortName Verstehen des digitalen Zeitalters", () => {
    const r = parseCourseNameParts("WI-M09-WI2013-F01-WiSe-2024-35276 WI24A Verstehen des digitalen Zeitalters  WiSe-2024");
    expect(r.semesterDir).toBe("Semester_1");
    expect(r.shortName).toBe("Verstehen des digitalen Zeitalters");
  });

  it("WI1021 → Semester_2, shortName Beschaffung/Produktion", () => {
    const r = parseCourseNameParts("WI-M03-WI1021-F01-SoSe-2025-42704 WI24A Beschaffung/Produktion SoSe-2025");
    expect(r.semesterDir).toBe("Semester_2");
    expect(r.shortName).toBe("Beschaffung/Produktion");
  });

  it("WI2023 → Semester_2, shortName Rechnersysteme", () => {
    const r = parseCourseNameParts("WI-M11-WI2023-F01-SoSe-2025-42713 WI24A Rechnersysteme SoSe-2025");
    expect(r.semesterDir).toBe("Semester_2");
    expect(r.shortName).toBe("Rechnersysteme");
  });

  it("WI2033 → Semester_3, shortName IT-Sicherheit", () => {
    const r = parseCourseNameParts("WI-22/2-M14-WI2033-F01-WiSe-2025-51414 WI24A IT-Sicherheit WiSe-2025");
    expect(r.semesterDir).toBe("Semester_3");
    expect(r.shortName).toBe("IT-Sicherheit");
  });

  it("WI3042 → Semester_4, shortName Geschäftsprozessmanagement", () => {
    const r = parseCourseNameParts("WI-22/2-M17-WI3042-F01-SoSe-2026-59386 WI24A Geschäftsprozessmanagement SoSe-2026");
    expect(r.semesterDir).toBe("Semester_4");
    expect(r.shortName).toBe("Geschäftsprozessmanagement");
  });

  it("WI3043 → Semester_4, shortName IT-Management", () => {
    const r = parseCourseNameParts("WI-22/2-M18-WI3043-F01-SoSe-2026-59387 WI24A IT-Management SoSe-2026");
    expect(r.semesterDir).toBe("Semester_4");
    expect(r.shortName).toBe("IT-Management");
  });

  it("WI3062 → Semester_6, shortName Management betrieblicher Informationssysteme", () => {
    const r = parseCourseNameParts("WI-22/2-M36-WI3062-F01-WiSe-2026-99001 WI24A Management betrieblicher Informationssysteme WiSe-2026");
    expect(r.semesterDir).toBe("Semester_6");
  });
});

describe("parseCourseNameParts — special categories", () => {
  it("WI6xxx with SK03a prefix → Semester_3, shortName SK_prefixed", () => {
    const r = parseCourseNameParts("WI-22/2-M32-SK03a-WI6036-F01-WiSe-2025-51417 WI24A Digitale Kompetenz - Computergestützte Statistische Datenanalyse WiSe-2025");
    expect(r.semesterDir).toBe("Semester_3");
    expect(r.shortName.startsWith("SK_")).toBe(true);
  });

  it("SK03a code (no WI6, SK pattern in prefix) → Semester_3, shortName SK_prefixed", () => {
    // The WI-22/2-M32-SK03a-F01-... format has no WI#### code at all
    const r = parseCourseNameParts("WI-22/2-M32-SK03a-F01-WiSe-2025-51417 WI24A Digitale Kompetenz - Computergestützte Statistische Datenanalyse WiSe-2025");
    expect(r.semesterDir).toBe("Semester_3");
    expect(r.shortName.startsWith("SK_")).toBe(true);
  });

  it("WI7xxx → Praxistransfer", () => {
    const r = parseCourseNameParts("WI-M71-WI7017-F01-WiSe-2024-35001 WI24A Praxistransfer I WiSe-2024");
    expect(r.semesterDir).toBe("Praxistransfer");
  });

  it("MSK01 pattern (Wissenschaftliches Arbeiten I) → Semester_1, shortName SK_Wissenschaftliches Arbeiten I", () => {
    const r = parseCourseNameParts("WI-MSK01-F01-WiSe-2024-35297 WI24A Wissenschaftliches Arbeiten I  WiSe-2024");
    expect(r.semesterDir).toBe("Semester_1");
    expect(r.shortName).toBe("SK_Wissenschaftliches Arbeiten I");
  });

  it("MSK02 pattern (Digitale Kompetenzen) → Semester_2, shortName SK_prefixed", () => {
    const r = parseCourseNameParts("WI-MSK02-F01-SoSe-2025-42734 WI24A Digitale Kompetenzen - Betriebssystempraxis SoSe-2025");
    expect(r.semesterDir).toBe("Semester_2");
    expect(r.shortName.startsWith("SK_")).toBe(true);
  });

  it("SK04b module (Ausbildung der Ausbilder) → Semester_4, shortName SK_prefixed", () => {
    const r = parseCourseNameParts("WI-22/2-M33-SK04b-F02-SoSe-2026-59389 WI24A Ausbildung der Ausbilder I SoSe-2026");
    expect(r.semesterDir).toBe("Semester_4");
    expect(r.shortName.startsWith("SK_")).toBe(true);
  });

  it("completely unrecognised name → Sonstiges", () => {
    const r = parseCourseNameParts("Some Random Course 2025");
    expect(r.semesterDir).toBe("Sonstiges");
    expect(r.shortName).toBeTruthy();
  });
});

describe("parseCourseNameParts — short name extraction", () => {
  it("strips the long code prefix and trailing semester tag", () => {
    const r = parseCourseNameParts("WI-22/2-M06-WI1041-F01-SoSe-2026-59384 WI24A Kostenrechnung und Controlling SoSe-2026");
    expect(r.shortName).toBe("Kostenrechnung und Controlling");
  });

  it("trims extra whitespace from short name", () => {
    const r = parseCourseNameParts("WI-M01-WI1011-F01-WiSe-2024-35267 WI24A Betriebswirtschaftliche Grundlagen  WiSe-2024");
    expect(r.shortName).toBe("Betriebswirtschaftliche Grundlagen");
    expect(r.shortName).not.toMatch(/\s{2,}/);
  });

  it("handles Prozessmodellierung (PM variant in course code)", () => {
    const r = parseCourseNameParts("WI-22/2-M17-PM-WI3042-F01-SoSe-2026-59386 WI24A Prozessmodellierung SoSe-2026");
    expect(r.semesterDir).toBe("Semester_4");
    expect(r.shortName).toBe("Prozessmodellierung");
  });

  it("multi-cohort course (WI24ABC in cohort) extracts name correctly", () => {
    const r = parseCourseNameParts("WI-22/2-M06-WI1041-F01-SoSe-2026-59384 59420 59421 WI24ABC Kostenrechnung und Controlling SoSe-2026");
    expect(r.semesterDir).toBe("Semester_4");
    expect(r.shortName).toBe("Kostenrechnung und Controlling");
  });
});

describe("buildCourseShortPaths — duplicate disambiguation", () => {
  it("unique courses get their shortName unchanged", () => {
    const courses = [
      { courseId: 1, courseName: "WI-M13-WI2032-F01-WiSe-2025-51413 WI24A Datenbanken WiSe-2025", courseUrl: "" },
      { courseId: 2, courseName: "WI-M14-WI2033-F01-WiSe-2025-51414 WI24A IT-Sicherheit WiSe-2025", courseUrl: "" },
    ];
    const map = buildCourseShortPaths(courses);
    expect(map.get(1)?.shortName).toBe("Datenbanken");
    expect(map.get(2)?.shortName).toBe("IT-Sicherheit");
  });

  it("duplicate shortNames in same semester get courseId suffix", () => {
    const courses = [
      { courseId: 59384, courseName: "WI-22/2-M06-WI1041-F01-SoSe-2026-59384 WI24A Kostenrechnung und Controlling SoSe-2026", courseUrl: "" },
      { courseId: 98551, courseName: "WI-22/2-M06-WI1041-F01-SoSe-2026-59384 59420 59421 WI24ABC Kostenrechnung und Controlling SoSe-2026", courseUrl: "" },
    ];
    const map = buildCourseShortPaths(courses);
    const n1 = map.get(59384)?.shortName ?? "";
    const n2 = map.get(98551)?.shortName ?? "";
    // Both should be disambiguated — different from plain "Kostenrechnung und Controlling"
    expect(n1).not.toBe(n2);
    // Each should contain the plain name as prefix
    expect(n1).toContain("Kostenrechnung");
    expect(n2).toContain("Kostenrechnung");
  });
});
