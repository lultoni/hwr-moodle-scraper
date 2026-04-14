// REQ-SEC-010 — SSRF defense: validate URLs belong to the configured Moodle origin
// before sending session cookies. Prevents credential leakage to external domains.

/**
 * Compare hostnames of two URLs. Returns true only when both URLs share
 * the same protocol, hostname (case-insensitive), and effective port.
 * Returns false for invalid URLs or protocol mismatches.
 */
export function isSameOrigin(targetUrl: string, baseUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const base = new URL(baseUrl);
    return target.origin === base.origin;
  } catch {
    return false;
  }
}

export class ExternalURLError extends Error {
  constructor(targetUrl: string, baseHost: string) {
    // Strip query params from the URL to avoid leaking sensitive parameters in error messages
    const safeUrl = sanitiseUrlForLog(targetUrl);
    super(`External URL rejected: ${safeUrl} is not on ${baseHost}`);
    this.name = "ExternalURLError";
  }
}

/**
 * Throw if targetUrl is not on the same origin as baseUrl.
 */
export function assertSameOrigin(targetUrl: string, baseUrl: string): void {
  if (!isSameOrigin(targetUrl, baseUrl)) {
    let baseHost: string;
    try {
      baseHost = new URL(baseUrl).hostname;
    } catch {
      baseHost = baseUrl;
    }
    throw new ExternalURLError(targetUrl, baseHost);
  }
}

/**
 * Strip query parameters and fragment from a URL for safe inclusion in log
 * messages and error text. Returns the original string if URL parsing fails.
 */
export function sanitiseUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}
