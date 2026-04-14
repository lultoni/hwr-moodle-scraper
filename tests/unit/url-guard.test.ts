// Covers: Security audit Phase 1 — SSRF defense
//
// Tests for URL domain validation: isSameOrigin, assertSameOrigin, sanitiseUrlForLog.
// Ensures session cookies are never sent to external domains.

import { describe, it, expect } from "vitest";
import { isSameOrigin, assertSameOrigin, ExternalURLError, sanitiseUrlForLog } from "../../src/http/url-guard.js";

describe("isSameOrigin", () => {
  const base = "https://moodle.hwr-berlin.de";

  it("returns true for same-domain URL", () => {
    expect(isSameOrigin("https://moodle.hwr-berlin.de/course/view.php?id=1", base)).toBe(true);
  });

  it("returns true for same domain with different path", () => {
    expect(isSameOrigin("https://moodle.hwr-berlin.de/mod/forum/view.php", base)).toBe(true);
  });

  it("returns true when baseUrl has trailing slash", () => {
    expect(isSameOrigin("https://moodle.hwr-berlin.de/course", "https://moodle.hwr-berlin.de/")).toBe(true);
  });

  it("returns false for different domain", () => {
    expect(isSameOrigin("https://evil.com/steal", base)).toBe(false);
  });

  it("returns false for subdomain (strict match)", () => {
    expect(isSameOrigin("https://api.moodle.hwr-berlin.de/data", base)).toBe(false);
  });

  it("returns false for superdomain", () => {
    expect(isSameOrigin("https://hwr-berlin.de/page", base)).toBe(false);
  });

  it("is case-insensitive for hostname", () => {
    expect(isSameOrigin("https://Moodle.HWR-Berlin.DE/course", base)).toBe(true);
  });

  it("returns false for different port", () => {
    expect(isSameOrigin("https://moodle.hwr-berlin.de:8443/path", base)).toBe(false);
  });

  it("returns true for same explicit port", () => {
    expect(isSameOrigin("https://moodle.hwr-berlin.de:443/path", base)).toBe(true);
  });

  it("returns false for HTTP URL (different protocol)", () => {
    expect(isSameOrigin("http://moodle.hwr-berlin.de/path", base)).toBe(false);
  });

  it("returns false for invalid target URL", () => {
    expect(isSameOrigin("not-a-url", base)).toBe(false);
  });

  it("returns false for javascript: protocol", () => {
    expect(isSameOrigin("javascript:alert(1)", base)).toBe(false);
  });
});

describe("assertSameOrigin", () => {
  const base = "https://moodle.hwr-berlin.de";

  it("does not throw for same-domain URL", () => {
    expect(() => assertSameOrigin("https://moodle.hwr-berlin.de/course", base)).not.toThrow();
  });

  it("throws ExternalURLError for cross-domain URL", () => {
    expect(() => assertSameOrigin("https://evil.com/steal", base)).toThrow(ExternalURLError);
  });

  it("ExternalURLError message includes target hostname", () => {
    try {
      assertSameOrigin("https://evil.com/steal", base);
    } catch (err) {
      expect((err as Error).message).toContain("evil.com");
    }
  });

  it("ExternalURLError message does NOT include query parameters", () => {
    try {
      assertSameOrigin("https://evil.com/steal?secret=token123", base);
    } catch (err) {
      expect((err as Error).message).not.toContain("token123");
    }
  });
});

describe("sanitiseUrlForLog", () => {
  it("strips query parameters", () => {
    expect(sanitiseUrlForLog("https://moodle.example.com/path?session=abc&token=xyz")).toBe(
      "https://moodle.example.com/path"
    );
  });

  it("strips fragment", () => {
    expect(sanitiseUrlForLog("https://moodle.example.com/path#section")).toBe(
      "https://moodle.example.com/path"
    );
  });

  it("returns URL unchanged when no query or fragment", () => {
    expect(sanitiseUrlForLog("https://moodle.example.com/path")).toBe(
      "https://moodle.example.com/path"
    );
  });

  it("returns original string for invalid URLs", () => {
    expect(sanitiseUrlForLog("not-a-url")).toBe("not-a-url");
  });
});
