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

import { collectFiles, groupUserFiles } from "../../src/fs/collect.js";

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
