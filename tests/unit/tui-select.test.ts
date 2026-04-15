// Tests for src/tui/select.ts (non-TTY path via promptFn fallback)

import { describe, it, expect, vi } from "vitest";

import { selectItem } from "../../src/tui/select.js";

const COMMON = { appTitle: "Test App", version: "v0.0.0", screenTitle: "── Test ──" };

describe("selectItem (non-TTY / promptFn fallback)", () => {
  const items = [
    { label: "Option A", value: "a" },
    { label: "Option B", value: "b" },
    { label: "Skip", value: "skip" },
  ];

  it("returns first item when user enters '1'", async () => {
    const promptFn = vi.fn().mockResolvedValue("1");
    const result = await selectItem({ ...COMMON, items, promptFn });
    expect(result).toBe("a");
  });

  it("returns second item when user enters '2'", async () => {
    const promptFn = vi.fn().mockResolvedValue("2");
    const result = await selectItem({ ...COMMON, items, promptFn });
    expect(result).toBe("b");
  });

  it("returns third item when user enters '3'", async () => {
    const promptFn = vi.fn().mockResolvedValue("3");
    const result = await selectItem({ ...COMMON, items, promptFn });
    expect(result).toBe("skip");
  });

  it("re-prompts when user enters invalid input, then succeeds", async () => {
    const promptFn = vi.fn()
      .mockResolvedValueOnce("0")   // invalid
      .mockResolvedValueOnce("99")  // invalid
      .mockResolvedValueOnce("2");  // valid
    const result = await selectItem({ ...COMMON, items, promptFn });
    expect(result).toBe("b");
    expect(promptFn).toHaveBeenCalledTimes(3);
  });

  it("re-prompts when user enters non-numeric input", async () => {
    const promptFn = vi.fn()
      .mockResolvedValueOnce("abc")
      .mockResolvedValueOnce("1");
    const result = await selectItem({ ...COMMON, items, promptFn });
    expect(result).toBe("a");
    expect(promptFn).toHaveBeenCalledTimes(2);
  });

  it("trims whitespace from user input", async () => {
    const promptFn = vi.fn().mockResolvedValue("  2  ");
    const result = await selectItem({ ...COMMON, items, promptFn });
    expect(result).toBe("b");
  });

  it("works with a single item", async () => {
    const promptFn = vi.fn().mockResolvedValue("1");
    const result = await selectItem({
      ...COMMON,
      screenTitle: "Single",
      items: [{ label: "Only", value: "only" }],
      promptFn,
    });
    expect(result).toBe("only");
  });
});
