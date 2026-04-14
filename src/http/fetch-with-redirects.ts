/**
 * Resolve HTTP redirects for a URL, returning the final response without reading the body.
 * Used by courses.ts (text body) and downloader.ts (binary stream) — each handles its own body.
 *
 * SSRF defense: when a redirect crosses to an external domain, the cookie header is stripped.
 */
import { isSameOrigin } from "./url-guard.js";

export async function resolveRedirects(
  url: string,
  headers: Record<string, string>,
  maxRedirects = 5,
): Promise<{ finalUrl: string; statusCode: number; resHeaders: Record<string, string | string[]> }> {
  const { request } = await import("undici");
  let currentUrl = url;
  let currentHeaders = { ...headers };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!currentUrl.startsWith("https://")) {
      throw new Error(`Insecure redirect URL rejected (http:// not allowed): ${currentUrl}`);
    }

    const { statusCode, headers: resHeaders, body } = await request(currentUrl, {
      method: "GET",
      headers: currentHeaders,
      headersTimeout: 30_000,
      bodyTimeout: 120_000,
    });

    if (statusCode >= 300 && statusCode < 400) {
      const location = resHeaders["location"];
      if (!location) {
        // No Location header — return this response for the caller to read
        return { finalUrl: currentUrl, statusCode, resHeaders: resHeaders as Record<string, string | string[]> };
      }
      const loc = Array.isArray(location) ? location[0]! : location;
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).toString();
      // Strip cookies when redirecting to an external domain
      if (!isSameOrigin(currentUrl, url) && currentHeaders.cookie) {
        const { cookie: _, ...rest } = currentHeaders;
        currentHeaders = rest as Record<string, string>;
      }
      await body.dump(); // drain to avoid memory leak
      continue;
    }

    // Non-redirect: return this response for the caller to handle the body
    // NOTE: body is NOT read here — caller must consume it
    return { finalUrl: currentUrl, statusCode, resHeaders: resHeaders as Record<string, string | string[]> };
  }

  throw new Error(`Too many redirects fetching ${url}`);
}
