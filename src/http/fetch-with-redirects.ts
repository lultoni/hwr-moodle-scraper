/**
 * Resolve HTTP redirects for a URL, returning the final response without reading the body.
 * Used by courses.ts (text body) and downloader.ts (binary stream) — each handles its own body.
 */
export async function resolveRedirects(
  url: string,
  headers: Record<string, string>,
  maxRedirects = 5,
): Promise<{ finalUrl: string; statusCode: number; resHeaders: Record<string, string | string[]> }> {
  const { request } = await import("undici");
  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!currentUrl.startsWith("https://")) {
      throw new Error(`Insecure redirect URL rejected (http:// not allowed): ${currentUrl}`);
    }

    const { statusCode, headers: resHeaders, body } = await request(currentUrl, {
      method: "GET",
      headers,
    });

    if (statusCode >= 300 && statusCode < 400) {
      const location = resHeaders["location"];
      if (!location) {
        // No Location header — return this response for the caller to read
        return { finalUrl: currentUrl, statusCode, resHeaders: resHeaders as Record<string, string | string[]> };
      }
      const loc = Array.isArray(location) ? location[0]! : location;
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).toString();
      await body.dump(); // drain to avoid memory leak
      continue;
    }

    // Non-redirect: return this response for the caller to handle the body
    // NOTE: body is NOT read here — caller must consume it
    return { finalUrl: currentUrl, statusCode, resHeaders: resHeaders as Record<string, string | string[]> };
  }

  throw new Error(`Too many redirects fetching ${url}`);
}
