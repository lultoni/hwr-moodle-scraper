// Pass 54 fix — msc ignored command
// Covers: runIgnored — show active exclude patterns, _User-Files dirs, User Files/ dir

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs
const mockExistsSync = vi.fn().mockReturnValue(false);
const mockReaddirSync = vi.fn().mockReturnValue([]);

vi.mock("node:fs", () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  readdirSync: (...a: unknown[]) => mockReaddirSync(...a),
}));

// Mock config
const mockGet = vi.fn().mockImplementation((key: string) => {
  if (key === "excludePaths") return Promise.resolve("");
  if (key === "outputDir") return Promise.resolve("/out");
  return Promise.resolve(undefined);
});

vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    ConfigManager: vi.fn().mockImplementation(() => ({ get: mockGet })),
  };
});

import { runIgnored } from "../../src/commands/ignored.js";

describe("runIgnored", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);  // no subdirs — stops recursion
    mockGet.mockImplementation((key: string) => {
      if (key === "excludePaths") return Promise.resolve("");
      return Promise.resolve(undefined);
    });
  });

  it("always lists built-in default exclude patterns", async () => {
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(s as string); return true; });
    await runIgnored({ outputDir: "/out" });
    spy.mockRestore();
    const text = out.join("");
    expect(text).toContain(".claude/**");
    expect(text).toContain(".git/**");
  });

  it("lists user-configured exclude patterns", async () => {
    mockGet.mockImplementation((key: string) =>
      key === "excludePaths" ? Promise.resolve("my-notes/**,.obsidian/**") : Promise.resolve(undefined)
    );
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(s as string); return true; });
    await runIgnored({ outputDir: "/out" });
    spy.mockRestore();
    const text = out.join("");
    expect(text).toContain("my-notes/**");
    expect(text).toContain(".obsidian/**");
  });

  it("shows 'none' message when no custom patterns configured", async () => {
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(s as string); return true; });
    await runIgnored({ outputDir: "/out" });
    spy.mockRestore();
    const text = out.join("");
    expect(text).toContain("none");
  });

  it("lists _User-Files directory when found", async () => {
    // Simulate outputDir exists, has one _User-Files subdir (readdirSync returns it, then empty for recursion)
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync
      .mockReturnValueOnce([{ name: "_User-Files", isDirectory: () => true, isFile: () => false }])
      .mockReturnValue([]);  // no further subdirs

    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(s as string); return true; });
    await runIgnored({ outputDir: "/out" });
    spy.mockRestore();
    const text = out.join("");
    expect(text).toContain("_User-Files");
  });

  it("shows 'none found' when no _User-Files dirs exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(s as string); return true; });
    await runIgnored({ outputDir: "/out" });
    spy.mockRestore();
    const text = out.join("");
    expect(text).toMatch(/none|not present/i);
  });

  it("mentions User Files/ dir when it exists", async () => {
    mockExistsSync.mockImplementation((p: unknown) =>
      typeof p === "string" && (p as string).endsWith("User Files")
    );
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(s as string); return true; });
    await runIgnored({ outputDir: "/out" });
    spy.mockRestore();
    const text = out.join("");
    expect(text).toContain("User Files");
  });
});
