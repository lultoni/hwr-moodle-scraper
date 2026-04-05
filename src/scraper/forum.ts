// Forum thread URL extraction and Moodle page content extraction for deep-dive scraping.
// REQ-SCRAPE-002 (extended: forum thread content)
//
// WHY THIS FILE EXISTS
// --------------------
// Moodle renders forum index pages and individual discussion pages as full HTML documents
// with navigation chrome, scripts, sidebars, and footer — typically 200+ KB per page.
// Converting raw page HTML with Turndown produces enormous .md files filled with nav links,
// breadcrumbs, and JavaScript snippets, obscuring the actual content.
//
// `extractPageContent` solves this by isolating the main content region before conversion.
// It is used by `runScrape` for ALL page-md strategy types (page, forum, quiz, book, etc.)
// and by the forum deep-dive loop for individual thread pages.
//
// `extractForumThreadUrls` drives the forum deep-dive: it extracts all discussion thread
// links from the forum index page so `runScrape` can fetch and include each thread's
// content in the single .md file written for the forum activity.

const MAX_THREADS = 100;

/**
 * Extract only the main content region from a full Moodle page HTML, stripping
 * navigation chrome, scripts, headers, and footers.
 *
 * WHY NOT A SIMPLE REGEX:
 *   The main content div (`<div role="main">` etc.) contains deeply nested child divs.
 *   A non-greedy `[\s\S]*?` pattern stops at the very first `</div>` it encounters,
 *   truncating the content. The balanced-div depth counter walks forward counting every
 *   `<div` open (+1) and `</div` close (-1), stopping only when depth returns to 0 —
 *   i.e. the matching closing tag of the container we opened.
 *
 * Tries in order:
 *   1. `<div role="main">` — Moodle 4.x / boost_union theme (primary)
 *   2. `<div id="page-content">` — classic Moodle themes
 *   3. `<div id="region-main">` — some older HWR theme variants
 *   4. Falls back to the full HTML if none of the above is found.
 *
 * Used by `runScrape` for:
 *   - All `page-md` strategy activities (page, forum, quiz, book, lesson, wiki, workshop)
 *   - Individual forum thread pages in the forum deep-dive loop
 *
 * DO NOT replace the balanced-div loop with a regex — Moodle main content is always
 * multi-level nested and the regex approach has been proven to break on real HWR pages.
 */
export function extractPageContent(html: string): string {
  const candidates = [
    /<div[^>]+role="main"[^>]*>/i,
    /<div[^>]+id="page-content"[^>]*>/i,
    /<div[^>]+id="region-main"[^>]*>/i,
  ];

  for (const openRe of candidates) {
    const openMatch = openRe.exec(html);
    if (!openMatch) continue;

    const innerStart = openMatch.index + openMatch[0].length;
    let depth = 1;
    let pos = innerStart;

    while (pos < html.length && depth > 0) {
      const nextOpen = html.indexOf("<div", pos);
      const nextClose = html.indexOf("</div", pos);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        pos = nextClose + 5;
      }
    }

    const inner = html.slice(innerStart, pos - 5).trim();
    if (inner) return inner;
  }

  return html;
}

/**
 * Extract all discussion thread URLs from a Moodle forum index page.
 * Returns an array of { title, url } objects, capped at MAX_THREADS.
 *
 * Matching strategy:
 *   Scans all `<a href="...discuss.php?d=N...">` links in the HTML.
 *   The `d=` parameter uniquely identifies a discussion thread in Moodle.
 *   Profile, user, and navigation links lack `discuss.php` and are ignored.
 *
 * Deduplication:
 *   The same discussion can appear multiple times in a forum page in two ways:
 *   (a) In both the subject column and the "last post" column, producing URLs like
 *       `discuss.php?d=42` and `discuss.php?d=42&parent=123`. The `&parent=` param
 *       references the latest reply but points to the same discussion.
 *   (b) Via `#anchor` fragments: `discuss.php?d=42#p123`.
 *   The dedup key is extracted as `d=NNN` (just the discussion ID) so both variants
 *   of the same thread collapse to one entry. The canonical URL stored is always the
 *   plain `discuss.php?d=NNN` form without extra params.
 *
 * Relative URL resolution:
 *   HWR Moodle consistently uses absolute hrefs, but relative paths starting
 *   with `/` are resolved against `baseUrl` as a safety measure.
 *
 * The 100-thread cap (MAX_THREADS) prevents pathological cases where a forum
 * index lists hundreds of entries — the deep-dive fetch loop would take too long.
 * Announcement forums at HWR typically have < 20 threads.
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

    // Dedup key: extract just the `d=NNN` discussion ID.
    // Forum index pages list each thread twice: once as the subject link
    // (discuss.php?d=NNN) and once as the "last post" link
    // (discuss.php?d=NNN&parent=MMM). Stripping only "#..." would leave the
    // &parent= variant as a different key → the same thread fetched twice.
    const dMatch = /[?&]d=(\d+)/.exec(href);
    const dedupKey = dMatch ? `d=${dMatch[1]}` : href.split("#")[0]!;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    // Always use the canonical URL without extra params (just d=NNN)
    const canonicalUrl = dMatch
      ? href.replace(/^([^?]+\?[^#]*)(&parent=\d+)([^#]*)/, "$1$3").split("#")[0]!
      : href.split("#")[0]!;
    threads.push({ title: rawTitle || dedupKey, url: canonicalUrl });
  }

  return threads;
}
