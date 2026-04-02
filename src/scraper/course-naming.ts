// Course name parsing and semester grouping for HWR WI (Wirtschaftsinformatik) courses.
// Maps raw Moodle course names to short human-readable names grouped by semester.

export interface CourseNameParts {
  semesterDir: string;  // e.g. "Semester_3", "Sonstiges"
  shortName: string;    // e.g. "Datenbanken" or "SK_Wissenschaftliches_Arbeiten_I"
}

export interface CourseRef {
  courseId: number;
  courseName: string;
  courseUrl: string;
}

/**
 * Maps HWR WI module code prefixes to semester directory names.
 * Pattern: WIxyzN where xy=year-group, z=sequence number (e.g. WI2032 = group 2, module 32).
 * Source: HWR Berlin WI curriculum structure (Modulübersicht WI ab Jahrgang 2022).
 */
const MODULE_SEMESTER: Record<string, string> = {
  "WI1011": "Semester_1", "WI1012": "Semester_1", "WI2013": "Semester_1",
  "WI2014": "Semester_1", "WI4015": "Semester_1",
  "WI1021": "Semester_2", "WI1022": "Semester_2", "WI2023": "Semester_2",
  "WI2024": "Semester_2", "WI4025": "Semester_2",
  "WI1031": "Semester_3", "WI2032": "Semester_3", "WI2033": "Semester_3",
  "WI2034": "Semester_3", "WI4035": "Semester_3",
  "WI1041": "Semester_4", "WI3042": "Semester_4", "WI2044": "Semester_4",
  "WI3043": "Semester_4",
  "WI1051": "Semester_5", "WI1052": "Semester_5", "WI3053": "Semester_5",
  "WI4054": "Semester_5", "WI4055": "Semester_5",
  "WI3062": "Semester_6", "WI3063": "Semester_6",
  "WI5064": "Semester_6", "WI5065": "Semester_6",
};

/**
 * Parse a raw Moodle course name into a semester directory and a short human-readable name.
 *
 * Expected input format (from HWR Moodle):
 *   "WI-22/2-M13-WI2032-F01-WiSe-2025-51413 WI24A Datenbanken WiSe-2025"
 *   "WI-M01-WI1011-F01-WiSe-2024-35267 WI24A Betriebswirtschaftliche Grundlagen  WiSe-2024"
 *
 * Semester determination:
 *   1. Look for WI#### module code in the name
 *   2. If /^WI6/ (Schlüsselkompetenzen): derive semester from SK/MSK number in code prefix
 *   3. If /^WI7/: Praxistransfer
 *   4. If SK/MSK pattern in code prefix but no WI#### match: same SK semester detection
 *   5. Look up in MODULE_SEMESTER map
 *   6. Fallback: Sonstiges
 *
 * SK courses: semesterDir is the plain semester (e.g. "Semester_1"), shortName gets "SK_" prefix.
 * Folder layout: <outputDir>/Semester_1/SK_Wissenschaftliches_Arbeiten_I/
 */
export function parseCourseNameParts(rawName: string): CourseNameParts {
  const semesterDir = detectSemesterDir(rawName);
  const shortName = extractShortName(rawName);
  return {
    semesterDir,
    shortName: isSkCourse(rawName) ? `SK_${shortName}` : shortName,
  };
}

/**
 * Returns true if this course is a Schlüsselkompetenzen (SK) course.
 * WI6xxx module codes and MSK/SK code prefixes are SK courses.
 * WI7xxx (Praxistransfer) and all other WI module codes are NOT SK courses.
 */
function isSkCourse(rawName: string): boolean {
  const moduleMatch = /\b(WI\d{4})\b/.exec(rawName);
  if (moduleMatch) {
    return /^WI6/.test(moduleMatch[1]!);
  }
  const prefix = rawName.split(" ")[0] ?? "";
  return /(?:^|[-])M?SK\d+/i.test(prefix);
}

function detectSemesterDir(rawName: string): string {
  // Find WI#### module code (e.g. WI2032, WI6036)
  const moduleMatch = /\b(WI\d{4})\b/.exec(rawName);
  if (moduleMatch) {
    const code = moduleMatch[1]!;
    if (/^WI6/.test(code)) {
      // WI6xxx = Schlüsselkompetenzen — derive plain semester from SK number in code prefix
      return detectSkSemester(rawName);
    }
    if (/^WI7/.test(code)) return "Praxistransfer";
    return MODULE_SEMESTER[code] ?? "Sonstiges";
  }

  // No WI#### — check for SK/MSK pattern in the code prefix (Schlüsselkompetenzen)
  // e.g. "WI-22/2-M32-SK03a-F01-..." or "WI-MSK02-F01-..."
  if (/(?:^|[-])M?SK\d+/i.test(rawName.split(" ")[0] ?? "")) {
    return detectSkSemester(rawName);
  }

  return "Sonstiges";
}

/**
 * Derive the plain semester directory for a Schlüsselkompetenzen course by parsing
 * the SK or MSK number from the course code prefix.
 *
 * Mapping (HWR WI curriculum):
 *   MSK01 / SK01x → Semester_1
 *   MSK02 / SK02x → Semester_2
 *   SK03x / WI60xx → Semester_3
 *   SK04x          → Semester_4
 *   SK05x          → Semester_5
 *   (higher / unknown) → Sonstiges (flat fallback)
 *
 * Returns e.g. "Semester_3" — the SK_ prefix on the shortName is applied by parseCourseNameParts.
 */
function detectSkSemester(rawName: string): string {
  const prefix = rawName.split(" ")[0] ?? "";

  // MSKnn → semester = nn
  const mskMatch = /\bMSK0*(\d+)/i.exec(prefix);
  if (mskMatch) {
    const n = parseInt(mskMatch[1]!, 10);
    if (n >= 1 && n <= 6) return `Semester_${n}`;
  }

  // SKnn[letter] → semester = nn
  const skMatch = /\bSK0*(\d+)/i.exec(prefix);
  if (skMatch) {
    const n = parseInt(skMatch[1]!, 10);
    if (n >= 1 && n <= 6) return `Semester_${n}`;
  }

  // WI6xxx without parseable SK number → flat fallback
  return "Sonstiges";
}

/**
 * Extract the human-readable short name from a raw Moodle course name.
 *
 * The human name sits between:
 *   - The cohort identifier (WI24A / WI24ABC / multiple IDs like "59420 59421 WI24ABC")
 *   - The trailing semester tag (WiSe-YYYY or SoSe-YYYY)
 *
 * Regex: looks for WI\d\d[A-Z]{1,6} cohort then captures everything up to the semester tag.
 */
function extractShortName(rawName: string): string {
  // Primary: cohort → human name → semester tag
  // Handles optional extra numeric IDs before the cohort: "59420 59421 WI24ABC"
  const m = /WI\d{2}[A-Z]{1,6}\s+(.*?)\s+(?:WiSe|SoSe)-\d{4}\s*$/.exec(rawName);
  if (m && m[1]) {
    return m[1].trim().replace(/\s+/g, " ");
  }

  // Fallback: strip known code prefix (everything up to and including the last hyphenated segment
  // that looks like a numeric ID or semester code) and return the rest.
  // Code prefix pattern: "WI-22/2-M13-WI2032-F01-WiSe-2025-51413" or "WI-M01-WI1011-F01-WiSe-2024-35267"
  const prefixMatch = /^(?:WI-[\w/]+-[A-Z]+\d+-(?:\w+-)*\d{5,}(?:\s+\d{5,})*)\s+(.+)$/.exec(rawName);
  if (prefixMatch && prefixMatch[1]) {
    // Also strip trailing semester tag if present
    return prefixMatch[1].replace(/\s+(?:WiSe|SoSe)-\d{4}\s*$/, "").trim().replace(/\s+/g, " ");
  }

  // Last resort: return the raw name
  return rawName.trim();
}

/**
 * Build a courseId → {semesterDir, shortName} map for a list of courses,
 * disambiguating duplicates by appending the last 5 digits of the courseId.
 */
export function buildCourseShortPaths(
  courses: CourseRef[],
): Map<number, { semesterDir: string; shortName: string }> {
  // First pass: compute base parts for each course
  const baseParts = courses.map((c) => ({ course: c, parts: parseCourseNameParts(c.courseName) }));

  // Count occurrences of each semesterDir/shortName pair
  const counts = new Map<string, number>();
  for (const { parts } of baseParts) {
    const key = `${parts.semesterDir}\0${parts.shortName}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Second pass: apply disambiguation suffix where needed
  const result = new Map<number, { semesterDir: string; shortName: string }>();
  for (const { course, parts } of baseParts) {
    const key = `${parts.semesterDir}\0${parts.shortName}`;
    const count = counts.get(key) ?? 1;
    const shortName = count > 1
      ? `${parts.shortName}_${String(course.courseId).slice(-5)}`
      : parts.shortName;
    result.set(course.courseId, { semesterDir: parts.semesterDir, shortName });
  }

  return result;
}
