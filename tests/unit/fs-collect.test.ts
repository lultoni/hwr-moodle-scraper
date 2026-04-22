// Tests for src/fs/collect.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

// --- fs mocks ---
const mockExistsSync = vi.fn().mockReturnValue(true);
const mockReaddirSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

import { collectFiles, groupUserFiles, mergedExcludePatterns, DEFAULT_EXCLUDE_PATTERNS } from "../../src/fs/collect.js";

// Helper to build a dirent-like object
function dir(name: string) {
  return { name, isDirectory: () => true, isFile: () => false };
}
function file(name: string) {
  return { name, isDirectory: () => false, isFile: () => true };
}

describe("collectFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it("returns empty array when directory does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(collectFiles("/out")).toEqual([]);
  });

  it("returns flat list of files from simple directory", () => {
    mockReaddirSync.mockReturnValue([file("a.pdf"), file("b.md")]);
    expect(collectFiles("/out")).toEqual([join("/out", "a.pdf"), join("/out", "b.md")]);
  });

  it("recursively collects files in subdirectories", () => {
    mockReaddirSync
      .mockReturnValueOnce([dir("Course"), file("root.txt")])
      .mockReturnValueOnce([file("lesson.pdf")]);
    expect(collectFiles("/out")).toEqual([join("/out", "Course", "lesson.pdf"), join("/out", "root.txt")]);
  });

  it("skips .moodle-scraper-state.json", () => {
    mockReaddirSync.mockReturnValue([file(".moodle-scraper-state.json"), file("a.pdf")]);
    expect(collectFiles("/out")).toEqual([join("/out", "a.pdf")]);
  });

  it("skips .meta.json files", () => {
    mockReaddirSync.mockReturnValue([file("file.meta.json"), file("file.pdf")]);
    expect(collectFiles("/out")).toEqual([join("/out", "file.pdf")]);
  });

  it("skips OS noise files (.DS_Store, Thumbs.db)", () => {
    mockReaddirSync.mockReturnValue([file(".DS_Store"), file("Thumbs.db"), file("a.pdf")]);
    expect(collectFiles("/out")).toEqual([join("/out", "a.pdf")]);
  });

  it("skips _User-Files directory entirely", () => {
    mockReaddirSync
      .mockReturnValueOnce([dir("_User-Files"), file("a.pdf")]);
    // Should NOT recurse into _User-Files and should return only a.pdf
    expect(collectFiles("/out")).toEqual([join("/out", "a.pdf")]);
  });

  it("still collects files from other directories alongside _User-Files", () => {
    mockReaddirSync
      .mockReturnValueOnce([dir("Course"), dir("_User-Files")])
      .mockReturnValueOnce([file("lecture.pdf")]);
    // _User-Files skipped; Course recursed
    expect(collectFiles("/out")).toEqual([join("/out", "Course", "lecture.pdf")]);
  });
});

// Pass 54 — mergedExcludePatterns and glob exclusion in collectFiles
describe("mergedExcludePatterns", () => {
  it("returns only built-in defaults for empty config string", () => {
    expect(mergedExcludePatterns("")).toEqual(DEFAULT_EXCLUDE_PATTERNS);
  });

  it("appends user patterns to defaults (no duplicates)", () => {
    const result = mergedExcludePatterns("my-notes/**,.private/**");
    expect(result).toContain(".claude/**");
    expect(result).toContain(".git/**");
    expect(result).toContain("my-notes/**");
    expect(result).toContain(".private/**");
  });

  it("deduplicates if user repeats a built-in default", () => {
    const result = mergedExcludePatterns(".claude/**");
    const count = result.filter((p) => p === ".claude/**").length;
    expect(count).toBe(1);
  });

  it("trims whitespace around patterns", () => {
    const result = mergedExcludePatterns(" my-notes/** , .private/** ");
    expect(result).toContain("my-notes/**");
    expect(result).toContain(".private/**");
  });
});

describe("collectFiles with excludePatterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it("skips .claude directory when .claude/** pattern given", () => {
    mockReaddirSync
      .mockReturnValueOnce([dir(".claude"), file("a.pdf")]);
    // With .claude/** pattern, .claude dir should be skipped entirely
    const result = collectFiles("/out", [".claude/**"]);
    expect(result).toEqual([join("/out", "a.pdf")]);
    // readdirSync should NOT be called a second time for .claude
    expect(mockReaddirSync).toHaveBeenCalledTimes(1);
  });

  it("skips files matching **/*.tmp pattern", () => {
    mockReaddirSync
      .mockReturnValueOnce([dir("Course"), file("notes.md")])
      .mockReturnValueOnce([file("lecture.pdf"), file("draft.tmp")]);
    const result = collectFiles("/out", ["**/*.tmp"]);
    expect(result).toContain(join("/out", "Course", "lecture.pdf"));
    expect(result).not.toContain(join("/out", "Course", "draft.tmp"));
    expect(result).toContain(join("/out", "notes.md"));
  });

  it("collects all files when excludePatterns is empty", () => {
    mockReaddirSync.mockReturnValue([file("a.pdf"), file("b.md")]);
    const result = collectFiles("/out", []);
    expect(result).toEqual([join("/out", "a.pdf"), join("/out", "b.md")]);
  });

  it("skips nested files matching pattern like my-notes/**", () => {
    mockReaddirSync
      .mockReturnValueOnce([dir("my-notes"), file("readme.md")])
      .mockReturnValueOnce([file("note1.md"), file("note2.md")]);
    const result = collectFiles("/out", ["my-notes/**"]);
    expect(result).toEqual([join("/out", "readme.md")]);
    // my-notes dir should not be recursed into
    expect(mockReaddirSync).toHaveBeenCalledTimes(1);
  });
});

describe("groupUserFiles", () => {
  const outputDir = "/out";

  it("returns empty array for empty input", () => {
    expect(groupUserFiles([], outputDir)).toEqual([]);
  });

  it("groups files under same first-level-custom dir into one group", () => {
    const files = [
      join("/out", "MyGuide", "chapter1.md"),
      join("/out", "MyGuide", "chapter2.md"),
    ];
    const groups = groupUserFiles(files, outputDir);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.absPath).toBe(join("/out", "MyGuide"));
    expect(groups[0]!.isDirectory).toBe(true);
    expect(groups[0]!.files).toEqual(files);
  });

  it("treats file directly in outputDir as individual group", () => {
    const files = [join("/out", "myfile.md")];
    const groups = groupUserFiles(files, outputDir);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.absPath).toBe(join("/out", "myfile.md"));
    expect(groups[0]!.isDirectory).toBe(false);
    expect(groups[0]!.files).toEqual([join("/out", "myfile.md")]);
  });

  it("groups nested files by their top-level directory", () => {
    const files = [
      join("/out", "Semester_1", "MyCourse", "notes.md"),
      join("/out", "Semester_1", "MyCourse", "refs.pdf"),
    ];
    const groups = groupUserFiles(files, outputDir);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.absPath).toBe(join("/out", "Semester_1"));
    expect(groups[0]!.isDirectory).toBe(true);
    expect(groups[0]!.files).toHaveLength(2);
  });

  it("creates separate groups for files under different top-level dirs", () => {
    const files = [
      join("/out", "DirA", "file.md"),
      join("/out", "DirB", "file.pdf"),
    ];
    const groups = groupUserFiles(files, outputDir);
    expect(groups).toHaveLength(2);
    const paths = groups.map((g) => g.absPath);
    expect(paths).toContain(join("/out", "DirA"));
    expect(paths).toContain(join("/out", "DirB"));
  });

  it("displayPath is relative to outputDir", () => {
    const files = [join("/out", "MyGuide", "file.md")];
    const groups = groupUserFiles(files, outputDir);
    expect(groups[0]!.displayPath).toBe("MyGuide");
  });

  it("file directly in outputDir has displayPath equal to filename", () => {
    const files = [join("/out", "notes.txt")];
    const groups = groupUserFiles(files, outputDir);
    expect(groups[0]!.displayPath).toBe("notes.txt");
  });

  it("mixed: directory group and lone file are separate groups", () => {
    const files = [
      join("/out", "Guide", "a.md"),
      join("/out", "standalone.txt"),
    ];
    const groups = groupUserFiles(files, outputDir);
    expect(groups).toHaveLength(2);
  });
});
