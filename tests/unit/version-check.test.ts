// Covers: REQ-CLI-011 — async GitHub release check
//
// Tests for parseSemver, isNewer, and checkForUpdate.
// checkForUpdate uses global fetch which is mocked via vi.stubGlobal.

import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSemver, isNewer, checkForUpdate, shouldCheck } from "../../src/version-check.js";

// ── parseSemver ───────────────────────────────────────────────────────────────

describe("parseSemver", () => {
  it("parses a standard semver string", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
  });

  it("strips leading 'v' prefix", () => {
    expect(parseSemver("v0.1.0")).toEqual([0, 1, 0]);
  });

  it("returns null for non-semver string", () => {
    expect(parseSemver("not-a-version")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSemver("")).toBeNull();
  });

  it("ignores pre-release suffix (takes only major.minor.patch)", () => {
    expect(parseSemver("v1.2.3-beta.1")).toEqual([1, 2, 3]);
  });
});

// ── isNewer ───────────────────────────────────────────────────────────────────

describe("isNewer", () => {
  it("returns true when major is higher", () => {
    expect(isNewer([1, 0, 0], [2, 0, 0])).toBe(true);
  });

  it("returns true when minor is higher", () => {
    expect(isNewer([1, 2, 0], [1, 3, 0])).toBe(true);
  });

  it("returns true when patch is higher", () => {
    expect(isNewer([1, 2, 3], [1, 2, 4])).toBe(true);
  });

  it("returns false for identical versions", () => {
    expect(isNewer([1, 2, 3], [1, 2, 3])).toBe(false);
  });

  it("returns false when candidate is older", () => {
    expect(isNewer([2, 0, 0], [1, 9, 9])).toBe(false);
  });
});

// ── checkForUpdate ────────────────────────────────────────────────────────────

describe("checkForUpdate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the newer version string when GitHub reports a higher version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v9.9.9" }),
    }));
    const result = await checkForUpdate("0.1.0");
    expect(result).toBe("9.9.9");
  });

  it("returns null when current version is up to date", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v0.1.0" }),
    }));
    const result = await checkForUpdate("0.1.0");
    expect(result).toBeNull();
  });

  it("returns null when current version is newer than GitHub release", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v0.0.1" }),
    }));
    const result = await checkForUpdate("0.1.0");
    expect(result).toBeNull();
  });

  it("returns null on network error (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));
    await expect(checkForUpdate("0.1.0")).resolves.toBeNull();
  });

  it("returns null when GitHub returns non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }));
    const result = await checkForUpdate("0.1.0");
    expect(result).toBeNull();
  });

  it("returns null when response has no tag_name field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: "Release" }), // no tag_name
    }));
    const result = await checkForUpdate("0.1.0");
    expect(result).toBeNull();
  });

  it("returns null when tag_name is unparseable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "not-a-semver" }),
    }));
    const result = await checkForUpdate("0.1.0");
    expect(result).toBeNull();
  });

  it("returns null when current version is unparseable (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v1.0.0" }),
    }));
    await expect(checkForUpdate("invalid")).resolves.toBeNull();
  });
});

// ── shouldCheck ──────────────────────────────────────────────────────────────

describe("shouldCheck", () => {
  it("returns true when never checked (lastCheckMs = 0)", () => {
    expect(shouldCheck(0, 24)).toBe(true);
  });

  it("returns false when checked just now (within cooldown)", () => {
    expect(shouldCheck(Date.now(), 24)).toBe(false);
  });

  it("returns true when last check was 25h ago (past 24h cooldown)", () => {
    expect(shouldCheck(Date.now() - 25 * 3_600_000, 24)).toBe(true);
  });

  it("returns false when last check was 10h ago (still in 24h cooldown)", () => {
    expect(shouldCheck(Date.now() - 10 * 3_600_000, 24)).toBe(false);
  });

  it("returns true when intervalHours = 0 (always check)", () => {
    expect(shouldCheck(Date.now(), 0)).toBe(true);
  });

  it("returns true when last check was exactly at interval boundary", () => {
    // 24h ago exactly — should be eligible
    expect(shouldCheck(Date.now() - 24 * 3_600_000, 24)).toBe(true);
  });

  it("respects custom interval (e.g. 1h)", () => {
    expect(shouldCheck(Date.now() - 2 * 3_600_000, 1)).toBe(true);
    expect(shouldCheck(Date.now() - 30 * 60_000, 1)).toBe(false);
  });
});

// ── USER_EDITABLE_KEYS sanity check ──────────────────────────────────────────

describe("Config: USER_EDITABLE_KEYS", () => {
  it("does not include logHintShown (internal flag)", async () => {
    const { USER_EDITABLE_KEYS } = await import("../../src/config.js");
    expect(USER_EDITABLE_KEYS).not.toContain("logHintShown");
  });

  it("includes checkUpdates (user-visible setting)", async () => {
    const { USER_EDITABLE_KEYS } = await import("../../src/config.js");
    expect(USER_EDITABLE_KEYS).toContain("checkUpdates");
  });

  it("includes updateCheckIntervalHours (user-visible setting)", async () => {
    const { USER_EDITABLE_KEYS } = await import("../../src/config.js");
    expect(USER_EDITABLE_KEYS).toContain("updateCheckIntervalHours");
  });

  it("does not include lastUpdateCheckMs (internal, not user-editable)", async () => {
    const { USER_EDITABLE_KEYS } = await import("../../src/config.js");
    expect(USER_EDITABLE_KEYS).not.toContain("lastUpdateCheckMs");
  });
});
