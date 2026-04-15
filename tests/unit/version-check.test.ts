// Covers: REQ-CLI-011 — async GitHub release check
//
// Tests for parseSemver, isNewer, and checkForUpdate.
// checkForUpdate uses global fetch which is mocked via vi.stubGlobal.

import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSemver, isNewer, checkForUpdate, shouldCheck, runUpdateCheck } from "../../src/version-check.js";

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

// ── runUpdateCheck ─────────────────────────────────────────────────────────────

describe("runUpdateCheck — T-7: quiet suppresses stderr", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeConfig(opts: {
    checkUpdates?: boolean;
    lastUpdateCheckMs?: number;
    intervalHours?: number;
  } = {}) {
    return {
      get: vi.fn().mockImplementation(async (key: string) => {
        if (key === "checkUpdates") return opts.checkUpdates ?? true;
        if (key === "lastUpdateCheckMs") return opts.lastUpdateCheckMs ?? 0;
        if (key === "updateCheckIntervalHours") return opts.intervalHours ?? 0;
        return undefined;
      }),
      set: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("when quiet=true and newer version available, nothing is written to stderr", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v9.9.9" }),
    }));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runUpdateCheck(makeConfig(), "0.1.0", true);

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("when quiet=false and newer version available, message is written to stderr", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v9.9.9" }),
    }));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runUpdateCheck(makeConfig(), "0.1.0", false);

    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("9.9.9");
    expect(output).toContain("New version available");
  });

  it("when quiet=true and fetch throws, nothing is written to stderr", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runUpdateCheck(makeConfig(), "0.1.0", true);

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("when quiet=false and fetch throws, nothing is written to stderr (no crash)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(runUpdateCheck(makeConfig(), "0.1.0", false)).resolves.toBeUndefined();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("no-ops when checkUpdates=false", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await runUpdateCheck(makeConfig({ checkUpdates: false }), "0.1.0", false);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no-ops when still within cooldown interval", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // lastUpdateCheckMs = now, intervalHours = 24 → still in cooldown
    await runUpdateCheck(makeConfig({ lastUpdateCheckMs: Date.now(), intervalHours: 24 }), "0.1.0", false);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("updates lastUpdateCheckMs in config after a real network check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v0.1.0" }), // same version — no message
    }));
    const cfg = makeConfig();

    await runUpdateCheck(cfg, "0.1.0", false);

    expect(cfg.set).toHaveBeenCalledWith("lastUpdateCheckMs", expect.any(Number));
  });
});
