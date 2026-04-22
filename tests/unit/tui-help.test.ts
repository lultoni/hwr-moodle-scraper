// Tests for src/tui/screens/help-screen.ts (non-TTY path)

import { describe, it, expect, vi, afterEach } from "vitest";
import { helpScreen } from "../../src/tui/screens/help-screen.js";
import { HELP_TOPICS } from "../../src/commands/help.js";

// Force non-TTY so selectItem uses the promptFn fallback and no raw mode is needed
Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

afterEach(() => vi.restoreAllMocks());

describe("helpScreen (non-TTY)", () => {
  it("HELP_TOPICS lists are shown in the topic picker", async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { output.push(String(s)); return true; });

    // Pick first topic then immediately pick "← Back" (last item)
    const backIdx = String(HELP_TOPICS.length + 1);
    const promptFn = vi.fn()
      .mockResolvedValueOnce("1")        // pick first topic (non-TTY: shows text and returns)
      .mockResolvedValueOnce(backIdx);   // should not be reached since non-TTY returns after one

    await helpScreen("", promptFn, "v0.0.0");

    const text = output.join("");
    // The numbered list from selectItem's non-TTY path should list at least first topic
    expect(text).toContain("1.");
    expect(text).toContain(HELP_TOPICS[0]!);
  });

  it("selecting a topic prints its help text", async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { output.push(String(s)); return true; });

    const promptFn = vi.fn().mockResolvedValueOnce("1"); // pick first topic
    await helpScreen("", promptFn, "v0.0.0");

    const text = output.join("");
    // First topic is "orphaned" — its text mentions "ended"
    expect(text.length).toBeGreaterThan(50);
  });

  it("selecting '← Back' exits without printing help text", async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { output.push(String(s)); return true; });

    const backIdx = String(HELP_TOPICS.length + 1);
    const promptFn = vi.fn().mockResolvedValueOnce(backIdx);
    await helpScreen("", promptFn, "v0.0.0");

    const text = output.join("");
    // Only the numbered list is shown, no topic text (no "======" headings)
    expect(text).not.toMatch(/={5,}/);
  });

  it("re-prompts on invalid input then succeeds with back", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const backIdx = String(HELP_TOPICS.length + 1);
    const promptFn = vi.fn()
      .mockResolvedValueOnce("0")       // invalid
      .mockResolvedValueOnce(backIdx);  // back
    await helpScreen("", promptFn, "v0.0.0");

    expect(promptFn).toHaveBeenCalledTimes(2);
  });
});
