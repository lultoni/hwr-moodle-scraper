// Forum thread URL extraction for deep-dive scraping.
// REQ-SCRAPE-002 (extended: forum thread content)

const MAX_THREADS = 100;

/**
 * Extract all discussion thread URLs from a Moodle forum index page.
 * Returns an array of { title, url } objects, capped at MAX_THREADS.
 * Handles both absolute and relative hrefs.
 */
export function extractForumThreadUrls(
  indexHtml: string,
  baseUrl: string,
): Array<{ title: string; url: string }> {
  const threads: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();

  // Match all <a href="...discuss.php?d=N...">...</a>
  const linkRe = /<a\s[^>]*href="([^"]*discuss\.php\?[^"]*\bd=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(indexHtml)) !== null && threads.length < MAX_THREADS) {
    let href = m[1]!.trim();
    const rawTitle = (m[2] ?? "").replace(/<[^>]+>/g, "").trim();

    // Resolve relative URLs
    if (href.startsWith("/")) {
      href = baseUrl.replace(/\/$/, "") + href;
    } else if (!href.startsWith("http")) {
      href = baseUrl.replace(/\/$/, "") + "/" + href;
    }

    // Normalise: strip trailing anchors / extra params beyond d= for dedup key
    const dedupKey = href.split("#")[0]!;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    threads.push({ title: rawTitle || dedupKey, url: href });
  }

  return threads;
}
