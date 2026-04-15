// UC-38: msc archive — remove courses from state without touching disk files

import { describe, it, expect, vi, afterEach } from "vitest";

function makeState() {
  return {
    courses: {
      "101": {
        name: "Macro Economics",
        sections: {
          "s1": {
            files: {
              "f1": { localPath: "/out/Macro/Section/file.pdf", status: "ok", hash: "abc", size: 100 },
            },
          },
        },
      },
      "202": {
        name: "Database Design",
        sections: {
          "s1": {
            files: {
              "f2": { localPath: "/out/DB/Section/slide.pdf", status: "ok", hash: "def", size: 200 },
              "f3": { localPath: "/out/DB/Section/note.pdf", status: "ok", hash: "ghi", size: 50 },
            },
          },
        },
      },
      "303": {
        name: "Operating Systems",
        sections: { "s1": { files: {} } },
      },
    },
    generatedFiles: ["/out/_README.md"],
  };
}

vi.mock("../../src/sync/state.js", () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(makeState()),
    save: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../src/scraper/course-filter.js", () => ({
  matchCourses: vi.fn((keyword: string, _state: unknown) => {
    const kw = keyword.toLowerCase();
    if (kw.includes("macro")) return { ids: [101], unmatched: [] };
    if (kw.includes("db") || kw.includes("database")) return { ids: [202], unmatched: [] };
    if (kw.includes("nonexistent")) return { ids: [], unmatched: ["nonexistent"] };
    return { ids: [101, 202], unmatched: [] };
  }),
}));

import { runArchive } from "../../src/commands/archive.js";
import { StateManager } from "../../src/sync/state.js";

function resetStateMock() {
  (StateManager as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(makeState()),
    save: vi.fn().mockResolvedValue(undefined),
  }));
}

describe("runArchive — no keyword filter (archive all)", () => {
  afterEach(() => { vi.clearAllMocks(); resetStateMock(); });

  it("lists all courses before archiving", async () => {
    resetStateMock();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    await runArchive({ outputDir: "/out", force: true });
    const text = out.join("");
    expect(text).toContain("Macro Economics");
    expect(text).toContain("Database Design");
    expect(text).toContain("Operating Systems");
  });

  it("archives all courses when --force and no keyword", async () => {
    resetStateMock();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    await runArchive({ outputDir: "/out", force: true });
    const text = out.join("");
    expect(text).toContain("Archived 3 courses");
    expect(text).toContain("untouched");
  });
});

describe("runArchive — keyword filter", () => {
  afterEach(() => { vi.clearAllMocks(); resetStateMock(); });

  it("archives only matched course", async () => {
    resetStateMock();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    await runArchive({ outputDir: "/out", courses: "macro", force: true });
    const text = out.join("");
    expect(text).toContain("Archived 1 course");
    expect(text).not.toContain("courses.");
  });

  it("shows unmatched keyword warning", async () => {
    resetStateMock();
    const err: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation((s) => { err.push(String(s)); return true; });
    await runArchive({ outputDir: "/out", courses: "nonexistent", force: true });
    const errText = err.join("");
    expect(errText).toContain("No courses matched");
  });

  it("exits early with 'No courses to archive' when no matches", async () => {
    resetStateMock();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runArchive({ outputDir: "/out", courses: "nonexistent", force: true });
    const text = out.join("");
    expect(text).toContain("No courses to archive");
  });
});

describe("runArchive — dry-run", () => {
  afterEach(() => { vi.clearAllMocks(); resetStateMock(); });

  it("prints dry-run message without saving", async () => {
    resetStateMock();
    const { StateManager: SM } = await import("../../src/sync/state.js");
    const saveMock = vi.fn();
    (SM as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      load: vi.fn().mockResolvedValue(makeState()),
      save: saveMock,
    }));
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    await runArchive({ outputDir: "/out", courses: "macro", dryRun: true, force: true });
    const text = out.join("");
    expect(text).toContain("[dry-run]");
    expect(text).toContain("1 course");
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe("runArchive — confirmation prompt", () => {
  afterEach(() => { vi.clearAllMocks(); resetStateMock(); });

  it("proceeds when user answers 'y'", async () => {
    resetStateMock();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    const promptFn = vi.fn().mockResolvedValue("y");
    await runArchive({ outputDir: "/out", courses: "macro", force: false, promptFn });
    expect(promptFn).toHaveBeenCalled();
    const text = out.join("");
    expect(text).toContain("Archived 1 course");
  });

  it("cancels when user answers 'n'", async () => {
    resetStateMock();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    const promptFn = vi.fn().mockResolvedValue("n");
    await runArchive({ outputDir: "/out", courses: "macro", force: false, promptFn });
    expect(promptFn).toHaveBeenCalled();
    const text = out.join("");
    expect(text).toContain("Cancelled");
  });

  it("skips prompt when --force", async () => {
    resetStateMock();
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    const promptFn = vi.fn();
    await runArchive({ outputDir: "/out", courses: "macro", force: true, promptFn });
    expect(promptFn).not.toHaveBeenCalled();
    const text = out.join("");
    expect(text).toContain("Archived 1 course");
  });
});

describe("runArchive — no state", () => {
  afterEach(() => { vi.clearAllMocks(); resetStateMock(); });

  it("prints message when no sync history", async () => {
    (StateManager as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn(),
    }));
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });
    await runArchive({ outputDir: "/out", force: true });
    const text = out.join("");
    expect(text).toContain("No sync history");
  });
});
