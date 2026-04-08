// REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-SCRAPE-012
import type { Logger } from "../logger.js";
export interface Course {
  courseId: number;
  courseName: string;
  courseUrl: string;
}

export interface Activity {
  activityType: string;
  activityName: string;
  /** URL to the activity page or resource. Empty string or undefined for labels and inaccessible items. */
  url: string;
  isAccessible: boolean;
  resourceId?: string;
  hash?: string;
  /** Raw inner HTML of activity-altcontent (label content or activity description). */
  description?: string;
  /** Optional subdirectory inside the section dir (used when folder files collide across folders). */
  subDir?: string;
}

export interface FolderFile {
  name: string;
  url: string;
}

export interface FolderResult {
  files: FolderFile[];
  /** Raw inner HTML of the folder description (from <div id="intro">), if present. */
  description?: string;
}

export interface Section {
  sectionId: string;
  sectionName: string;
  activities: Activity[];
  /**
   * Raw inner HTML of the section's `<div class="summarytext">` block, if present.
   *
   * Moodle 4.x (boost_union theme) places a rich-text section description directly
   * above the activity list inside each `<li class="section">`. It is extracted in
   * `parseContentTree` using a balanced-div depth counter and written to disk by
   * `runScrape` as `_Abschnittsbeschreibung.md` in the section directory.
   *
   * This is DIFFERENT from `ContentTree.summary`, which is the course-level description.
   */
  summary?: string;
  /** Moodle's `data-number` attribute on the `<li class="section">` element. Used to match
   *  onetopic tab numbers to parsed sections. */
  dataNumber?: number;
}

export interface ContentTree {
  courseId: number;
  sections: Section[];
  /** Raw inner HTML of the course summary/description, or undefined if not present. */
  summary?: string;
}

export interface FetchOptions {
  baseUrl: string;
  sessionCookies: string;
  logger?: Logger;
}

/** Strip <span class="accesshide"> (and contents) from HTML then strip remaining tags. */
function stripAccessHide(html: string): string {
  // Remove accesshide spans and their text content
  return html
    .replace(/<span[^>]+class="[^"]*accesshide[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/** Decode HTML entities in a plain-text string. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/gi, (_, d: string) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

/**
 * Parse onetopic-format tab nav to build sectionNumber → name map.
 * Matches: <li id="onetabid-NNN"...><a href="...section=N...">Name</a>
 *
 * HTML entities: In HTML source, `&` in href attributes is encoded as `&amp;`.
 * The regex must match both literal `&` (when parsing programmatically-decoded HTML)
 * and the HTML entity form `&amp;` so that URLs like:
 *   href="...?id=88019&amp;section=2#tabs-tree-start"
 * are correctly matched. Without this, tabs 2..N are silently ignored and only
 * section 0 + the initially-active section are scraped.
 */
function parseOnetopicTabs(html: string): Map<number, string> {
  const map = new Map<number, string>();
  const tabRe = /id="onetabid-\d+"[\s\S]*?href="[^"]*[?&](?:amp;)?section=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = tabRe.exec(html)) !== null) {
    const sectionNum = parseInt(m[1]!, 10);
    const name = decodeHtmlEntities(m[2]!.replace(/<[^>]+>/g, "").trim());
    if (name && !map.has(sectionNum)) map.set(sectionNum, name);
  }
  return map;
}

/**
 * Parse onetopic tab nav to build an ordered list of { sectionNum, name } entries.
 * Used to iterate and fetch each section page.
 * Same &amp; → & entity fix as parseOnetopicTabs.
 */
function parseOnetopicTabList(html: string): Array<{ sectionNum: number; name: string }> {
  const tabs: Array<{ sectionNum: number; name: string }> = [];
  const tabRe = /id="onetabid-\d+"[\s\S]*?href="[^"]*[?&](?:amp;)?section=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = tabRe.exec(html)) !== null) {
    const sectionNum = parseInt(m[1]!, 10);
    const name = decodeHtmlEntities(m[2]!.replace(/<[^>]+>/g, "").trim());
    if (name) tabs.push({ sectionNum, name });
  }
  return tabs;
}

/**
 * Parse format-grid course overview page to extract section card URLs.
 * Each card has: <div class="grid-section card" title="SectionName">
 *   <a href="/course/section.php?id=SECTIONID">
 */
function parseGridSectionCards(html: string, baseUrl: string): Array<{ name: string; url: string }> {
  const cards: Array<{ name: string; url: string }> = [];
  const cardRe = /<div[^>]+class="[^"]*grid-section[^"]*"[^>]+title="([^"]*)"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const name = decodeHtmlEntities(m[1]!.trim());
    const href = m[2]!;
    const url = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
    if (name && url) cards.push({ name, url });
  }
  return cards;
}

/**
 * Parse course search results or dashboard HTML into a Course list.
 *
 * Strategy: find all elements with data-courseid, then within each element's
 * vicinity locate the coursename link. This is robust against attribute ordering
 * and minor layout variations across Moodle themes.
 */
function parseCourseSearchHtml(html: string, baseUrl: string): Course[] {
  const courses: Course[] = [];
  const seen = new Set<number>();

  // Step 1: find every data-courseid occurrence and its position
  const idRe = /data-courseid="(\d+)"/g;
  let idMatch: RegExpExecArray | null;

  while ((idMatch = idRe.exec(html)) !== null) {
    const courseId = parseInt(idMatch[1]!, 10);
    if (seen.has(courseId)) continue;

    // Step 2: from the data-courseid position, scan forward for the coursename link
    // Search in the next 2000 chars to stay within this card's DOM scope
    const slice = html.slice(idMatch.index, idMatch.index + 2000);
    const linkRe = /class="coursename"[\s\S]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
    const linkMatch = linkRe.exec(slice);
    if (!linkMatch) continue;

    const courseUrl = linkMatch[1]!;
    const rawName = linkMatch[2]!.replace(/<[^>]+>/g, "").trim();
    if (!courseUrl || !rawName) continue;

    seen.add(courseId);
    courses.push({ courseId, courseName: rawName, courseUrl });
  }

  return courses;
}

/**
 * Fetch all enrolled courses from the Moodle dashboard.
 *
 * Strategy:
 *   1. GET /my/ to obtain a fresh sesskey embedded in the page HTML.
 *   2. POST to /lib/ajax/service.php with core_course_get_enrolled_courses_by_timeline_classification
 *      to fetch the full course list via the Moodle Web Services AJAX API.
 *   3. Fall back to parsing static HTML (data-courseid + coursename link) if the API call fails.
 */
export async function fetchEnrolledCourses(opts: FetchOptions): Promise<Course[]> {
  const { baseUrl, sessionCookies } = opts;

  // Step 1: fetch dashboard to get a fresh sesskey
  const dashUrl = `${baseUrl}/my/`;
  const { statusCode: dashStatus, body: dashHtml } = await fetchWithRedirects(dashUrl, { cookie: sessionCookies });
  if (dashStatus >= 400) throw new Error(`Dashboard fetch failed: HTTP ${dashStatus}`);

  const sesskeyMatch = /"sesskey":"([^"]+)"/.exec(dashHtml);
  const sesskey = sesskeyMatch?.[1];

  if (sesskey) {
    // Step 2: call Moodle AJAX API
    const ajaxUrl = `${baseUrl}/lib/ajax/service.php?sesskey=${sesskey}&info=core_course_get_enrolled_courses_by_timeline_classification`;
    const payload = JSON.stringify([{
      index: 0,
      methodname: "core_course_get_enrolled_courses_by_timeline_classification",
      args: { offset: 0, limit: 0, classification: "all", sort: "shortname", customfieldname: "", customfieldvalue: "" },
    }]);
    const { request: undiciRequest } = await import("undici");
    const { statusCode: ajaxStatus, body: ajaxBody } = await undiciRequest(ajaxUrl, {
      method: "POST",
      headers: { cookie: sessionCookies, "content-type": "application/json" },
      body: payload,
    });
    if (ajaxStatus < 400) {
      const ajaxText = await ajaxBody.text();
      try {
        const parsed = JSON.parse(ajaxText) as Array<{ error: boolean; data?: { courses?: AjaxCourse[] } }>;
        const result = parsed[0];
        if (result && !result.error && result.data?.courses) {
          return result.data.courses.map((c) => ({
            courseId: c.id,
            // Combine shortname + fullname so parseCourseNameParts() can find the WI#### module
            // code embedded in the shortname (e.g. "WI-22/2-M13-WI2032-F01-WiSe-2025-51413").
            // Only prepend shortname when it differs from fullname — identical values (e.g.
            // "Bibliothek benutzen" / "Bibliothek benutzen") would produce a doubled folder name.
            courseName: (c.shortname && c.shortname !== c.fullname)
              ? `${c.shortname} ${c.fullname}`
              : c.fullname,
            courseUrl: `${baseUrl}/course/view.php?id=${c.id}`,
          }));
        }
      } catch {
        // fall through to HTML fallback
      }
    } else {
      await ajaxBody.dump();
    }
  }

  // Step 3: fallback — try /my/courses.php static HTML (older Moodle themes)
  const coursesUrl = `${baseUrl}/my/courses.php?myoverviewfilter=all&perpage=200`;
  const { statusCode, body } = await fetchWithRedirects(coursesUrl, { cookie: sessionCookies });
  if (statusCode >= 400) throw new Error(`Enrolled courses fetch failed: HTTP ${statusCode}`);

  return parseCourseSearchHtml(body, baseUrl);
}

interface AjaxCourse {
  id: number;
  fullname: string;
  shortname: string;
}

/** Fetch with basic redirect following (up to maxRedirects hops). */
async function fetchWithRedirects(
  url: string,
  headers: Record<string, string>,
  maxRedirects = 5,
): Promise<{ statusCode: number; body: string; finalUrl: string }> {
  const { request } = await import("undici");
  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!currentUrl.startsWith("https://")) throw new Error(`Insecure redirect URL rejected (http:// not allowed): ${currentUrl}`);

    const { statusCode, headers: resHeaders, body } = await request(currentUrl, {
      method: "GET",
      headers,
    });

    if (statusCode >= 300 && statusCode < 400) {
      const location = resHeaders["location"];
      if (!location) {
        return { statusCode, body: await body.text(), finalUrl: currentUrl };
      }
      const loc = Array.isArray(location) ? location[0]! : location;
      // Resolve relative redirects
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).toString();
      await body.dump(); // drain to avoid memory leak
      continue;
    }

    return { statusCode, body: await body.text(), finalUrl: currentUrl };
  }

  throw new Error(`Too many redirects fetching ${url}`);
}

/**
 * Extract course summary/description from the course homepage HTML.
 * Returns the raw inner HTML of the summary block, or null if absent/empty.
 *
 * Handles multiple Moodle theme variants (tried in order):
 *   1. `<div class="summary">` — classic Moodle, nested inside `<div class="course-description">`
 *   2. `<div class="course-summary-section">` — some HWR-specific theme variants
 *   3. `<div class="summarytext">` — Moodle 4.x boost_union theme; used in onetopic-format
 *      courses where the "course description" is the section-0 summary text (e.g. GPM, RTG).
 *      NOTE: `\bsummary\b` does NOT match "summarytext" (no word boundary after "summary" in
 *      "summarytext"), so candidate 1 and 3 are distinct.
 *
 * Why balanced-div instead of a non-greedy regex:
 *   Course descriptions commonly contain nested `<div>` elements (e.g. `<div class="no-overflow">`,
 *   inline image wrappers, formatted text blocks). A non-greedy `[\s\S]*?` regex stops at the
 *   very first `</div>` — truncating multi-paragraph content. The balanced-div depth counter
 *   correctly walks to the matching closing tag regardless of nesting depth.
 *
 * Returns null if the block is missing, blank, or contains only HTML tags with no text.
 */
export function extractCourseDescription(html: string): string | null {
  const candidates = [
    /<div[^>]+class="[^"]*\bsummary\b[^"]*"[^>]*>/i,
    /<div[^>]+class="[^"]*\bcourse-summary-section\b[^"]*"[^>]*>/i,
    /<div[^>]+class="[^"]*\bsummarytext\b[^"]*"[^>]*>/i,
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
    if (inner.replace(/<[^>]+>/g, "").trim()) return inner;
  }

  return null;
}

export async function fetchCourseList(opts: FetchOptions & { searchQuery?: string }): Promise<Course[]> {
  const { baseUrl, sessionCookies, searchQuery } = opts;

  if (!searchQuery) return [];

  // Use perpage=all to fetch all results in a single request
  const url = `${baseUrl}/course/search.php?search=${encodeURIComponent(searchQuery)}&perpage=all`;
  const { statusCode, body } = await fetchWithRedirects(url, { cookie: sessionCookies });

  if (statusCode >= 400) throw new Error(`Course list fetch failed: HTTP ${statusCode}`);

  return parseCourseSearchHtml(body, baseUrl);
}

export async function fetchContentTree(opts: FetchOptions & { courseId: number }): Promise<ContentTree> {
  const { baseUrl, courseId, sessionCookies } = opts;
  const headers = { cookie: sessionCookies };

  const { statusCode, body } = await fetchWithRedirects(
    `${baseUrl}/course/view.php?id=${courseId}`,
    headers,
  );

  if (statusCode >= 400) throw new Error(`Content tree fetch failed: HTTP ${statusCode}`);

  // Detect format-grid: sections are shown as cards, each with a separate section URL
  if (body.includes("format-grid") && body.includes("grid-section")) {
    const gridCards = parseGridSectionCards(body, baseUrl);
    if (gridCards.length > 0) {
      // Parse section-0 (general section) from main page, then each grid section separately
      const mainTree = parseContentTree(body, courseId, baseUrl, opts.logger);
      const allSections: Section[] = mainTree.sections.length > 0 ? [mainTree.sections[0]!] : [];

      await Promise.all(
        gridCards.map(async (card, idx) => {
          const { statusCode: sc, body: sectionBody } = await fetchWithRedirects(card.url, headers);
          if (sc >= 400) return;
          // Parse section page — it contains a single section <li>
          const sectionTree = parseContentTree(sectionBody, courseId, baseUrl, opts.logger);
          // Take the first section with activities; override the name from the card title
          const section = sectionTree.sections.find((s) => s.activities.length > 0)
            ?? sectionTree.sections[0];
          if (section) {
            allSections.push({
              ...section,
              sectionId: `s${idx + 1}`,
              sectionName: card.name,
            });
          }
        }),
      );

      return { courseId, sections: allSections };
    }
  }

  // Detect format-onetopic: sections are shown one at a time via tabs; each tab is a separate fetch
  const onetopicTabList = parseOnetopicTabList(body);
  if (onetopicTabList.length > 0) {
    // Parse the active section from the main page
    const mainTree = parseContentTree(body, courseId, baseUrl, opts.logger);
    // Use actual data-number values (not array indices) to identify which sections are already present
    const activeSectionNums = new Set(
      mainTree.sections.filter((s) => s.dataNumber !== undefined).map((s) => s.dataNumber!)
    );

    const allSections: Section[] = [...mainTree.sections];

    await Promise.all(
      onetopicTabList.map(async ({ sectionNum, name }) => {
        // Skip sections already present (e.g. the active one returned in mainTree)
        if (activeSectionNums.has(sectionNum)) {
          // Update its name from the tab nav
          const existing = allSections.find((s) => s.dataNumber === sectionNum);
          if (existing) existing.sectionName = name;
          return;
        }
        const url = `${baseUrl}/course/view.php?id=${courseId}&section=${sectionNum}`;
        const { statusCode: sc, body: tabBody } = await fetchWithRedirects(url, headers);
        if (sc >= 400) return;
        const tabTree = parseContentTree(tabBody, courseId, baseUrl, opts.logger);
        // Find the section matching the requested sectionNum by data-number
        const section = tabTree.sections.find((s) => s.dataNumber === sectionNum) ?? tabTree.sections[0];
        if (section) {
          allSections.push({ ...section, sectionId: `s${sectionNum}`, sectionName: name });
        }
      }),
    );

    // Sort sections by sectionId order
    allSections.sort((a, b) => {
      const na = parseInt(a.sectionId.slice(1), 10);
      const nb = parseInt(b.sectionId.slice(1), 10);
      return na - nb;
    });

    // Onetopic tab names override parseContentTree's section naming, so apply
    // canonical naming for section 0 here (after tab name assignment + sort).
    // Moodle's default "Abschnitt N" / "Thema N" names are unhelpful for the
    // general section.
    if (allSections.length > 0 && /^(?:Abschnitt|Thema|Topic|Section)\s+\d+$/i.test(allSections[0]!.sectionName.trim())) {
      allSections[0] = { ...allSections[0]!, sectionName: "Allgemeines" };
    }

    return { courseId, sections: allSections, summary: extractCourseDescription(body) ?? undefined };
  }

  const tree = parseContentTree(body, courseId, baseUrl, opts.logger);
  return { ...tree, summary: extractCourseDescription(body) ?? undefined };
}

/** Fetch a folder page and return all downloadable file links. */
export async function fetchFolderFiles(
  opts: FetchOptions & { folderUrl: string },
): Promise<FolderResult> {
  const { folderUrl, sessionCookies } = opts;

  const { statusCode, body } = await fetchWithRedirects(folderUrl, { cookie: sessionCookies });
  if (statusCode >= 400) return { files: [] };

  return {
    files: parseFolderFiles(body),
    description: parseFolderDescription(body),
  };
}

/**
 * Extract the folder intro/description from the folder view page.
 * Moodle places it in: <div class="activity-description" id="intro">
 *                         <div class="no-overflow">...HTML...</div>
 *                       </div>
 * We extract the inner HTML of the "no-overflow" div using a balanced-div counter.
 */
function parseFolderDescription(html: string): string | undefined {
  // Find the intro div
  const introIdx = html.indexOf('id="intro"');
  if (introIdx === -1) return undefined;

  // Walk forward to find <div class="no-overflow"> inside the intro block
  const noOverflowIdx = html.indexOf('class="no-overflow"', introIdx);
  if (noOverflowIdx === -1) return undefined;

  const contentStart = html.indexOf(">", noOverflowIdx) + 1;
  if (contentStart <= 0) return undefined;

  // Use balanced-div depth counter to find the matching </div>
  let depth = 1;
  let pos = contentStart;
  while (pos < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", pos);
    const nextClose = html.indexOf("</div>", pos);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) {
        const inner = html.slice(contentStart, nextClose).trim();
        if (inner) return inner;
      }
      pos = nextClose + 6;
    }
  }
  return undefined;
}

function parseFolderFiles(html: string): FolderFile[] {
  const files: FolderFile[] = [];

  // Real Moodle folder structure (Moodle 4.x): <span class="fp-filename"><a href="...?forcedownload=1">name.pdf</a></span>
  // Match the fp-filename span and extract href + link text.
  const spanRe = /<span[^>]+class="[^"]*fp-filename[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let m: RegExpExecArray | null;
  while ((m = spanRe.exec(html)) !== null) {
    const spanInner = m[1]!;
    const linkMatch = /<a[^>]+href="([^"]*(?:pluginfile\.php|forcedownload)[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(spanInner);
    if (!linkMatch) continue;
    const href = linkMatch[1]!;
    const rawName = linkMatch[2]!.replace(/<[^>]+>/g, "").trim()
      || decodeURIComponent(href.split("/").pop()?.split("?")[0] ?? "") || "file";
    files.push({ name: rawName, url: href });
  }

  // Fallback: older Moodle structure where <a> wraps <span class="fp-filename">
  // <a href="...pluginfile.php..."><span class="fp-filename">name.pdf</span></a>
  if (files.length === 0) {
    const linkRe = /<a[^>]+href="([^"]*(?:pluginfile\.php|forcedownload)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = linkRe.exec(html)) !== null) {
      const href = m[1]!;
      const innerHtml = m[2]!;
      const nameSpanMatch = /<span[^>]+class="[^"]*fp-filename[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(innerHtml);
      const rawName = nameSpanMatch
        ? nameSpanMatch[1]!.replace(/<[^>]+>/g, "").trim()
        : decodeURIComponent(href.split("/").pop()?.split("?")[0] ?? "") || "file";
      files.push({ name: rawName, url: href });
    }
  }

  return files;
}

/**
 * Parse a Moodle course page HTML into a ContentTree of sections and activities.
 *
 * Section name resolution uses three fallbacks in order:
 *   1. `data-sectionname` attribute on the section `<li>` (new Moodle 4.x HTML)
 *   2. `<h3 class="sectionname">` heading text (classic Moodle layout)
 *   3. Onetopic format: look up the section number in the pre-parsed onetopic tab nav
 *      (`parseOnetopicTabs`), which maps `section=N` query parameters to tab labels.
 *
 * Activity names are extracted from the link text with `<span class="accesshide">` stripped
 * to prevent Moodle's screenreader-only labels ("Datei", "Forum", etc.) from polluting names.
 *
 * Section summaries (`Section.summary`):
 *   Each section chunk is scanned for `<div class="summarytext">`, which Moodle 4.x uses to
 *   display a rich-text description above the activity list. The content is extracted with a
 *   balanced-div depth counter (same technique as `extractCourseDescription`) and stored in
 *   `Section.summary`. The caller (`runScrape`) writes this to `_Abschnittsbeschreibung.md`
 *   in the section directory. Do NOT simplify the balanced-div loop to a regex — section
 *   descriptions routinely contain nested divs (image wrappers, formatting containers).
 */
function parseContentTree(html: string, courseId: number, baseUrl: string, logger?: Logger): ContentTree {
  const sections: Section[] = [];
  let sectionIndex = 0;

  // Pre-parse onetopic tab names once (used as 3rd fallback)
  const onetopicTabs = parseOnetopicTabs(html);

  // Split by section boundaries — handles both old (class="section") and new Moodle HTML
  // where the <li> tag spans multiple lines with data-sectionname attribute
  const sectionChunks = html.split(/<li[^>]+class="[^"]*\bsection\b[^"]*"/i);

  for (let i = 1; i < sectionChunks.length; i++) {
    const chunk = sectionChunks[i] ?? "";

    // Extract Moodle's data-number attribute (always, not just for name fallback)
    const dataNumMatchGlobal = /data-number="(\d+)"/i.exec(chunk);
    const dataNumber = dataNumMatchGlobal ? parseInt(dataNumMatchGlobal[1]!, 10) : undefined;

    // 1. data-sectionname attribute (new Moodle)
    // 2. <h3 class="sectionname"> heading
    // 3. Onetopic tab nav (data-number → tab map)
    const dataNameMatch = /data-sectionname="([^"]+)"/i.exec(chunk);
    let sectionName: string;
    if (dataNameMatch) {
      sectionName = decodeHtmlEntities(dataNameMatch[1]!).trim();
    } else {
      const h3Match = /<h[1-6][^>]+class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(chunk);
      if (h3Match) {
        sectionName = decodeHtmlEntities(h3Match[1]!.replace(/<[^>]+>/g, "").trim());
      } else {
        // Onetopic: use data-number to look up tab name
        const dataNumMatch = /data-number="(\d+)"/i.exec(chunk);
        const sectionNum = dataNumMatch ? parseInt(dataNumMatch[1]!, 10) : -1;
        sectionName = (sectionNum >= 0 && onetopicTabs.get(sectionNum)) || `Section ${sectionIndex}`;
      }
    }
    // Guard: Moodle sometimes sets data-sectionname to a space or empty string for the
    // general/intro section (section 0). Fall back to a canonical name in that case.
    // Also: Moodle's default section names "Abschnitt N" / "Thema N" / "Topic N" / "Section N"
    // are unhelpful for section 0 — use "Allgemeines" instead.
    if (!sectionName.trim()) {
      sectionName = sectionIndex === 0 ? "Allgemeines" : `Section ${sectionIndex}`;
    } else if (sectionIndex === 0 && /^(?:Abschnitt|Thema|Topic|Section)\s+\d+$/i.test(sectionName.trim())) {
      sectionName = "Allgemeines";
    }

    const activities: Activity[] = [];

    // Find all activity items — <li class="activity ...">
    // (regex declared inside loop intentionally: /g flag carries stateful lastIndex)
    const activityOpenRe = /<li([^>]+class="[^"]*\bactivity\b[^"]*"[^>]*)>/gi;
    let actMatch: RegExpExecArray | null;
    while ((actMatch = activityOpenRe.exec(chunk)) !== null) {
      const attrs = actMatch[1] ?? "";
      const afterOpen = chunk.slice(actMatch.index);
      const result = parseActivityFromElement(
        attrs + afterOpen,
        `${baseUrl}/course/view.php?id=${courseId}`,
        logger,
      );
      if (result) activities.push(result);
    }

    // Extract section description from <div class="summarytext"> using balanced-div counter
    let sectionSummary: string | undefined;
    const summaryOpenRe = /<div[^>]+class="[^"]*\bsummarytext\b[^"]*"[^>]*>/i;
    const summaryMatch = summaryOpenRe.exec(chunk);
    if (summaryMatch) {
      const innerStart = summaryMatch.index + summaryMatch[0].length;
      let depth = 1;
      let pos = innerStart;
      while (pos < chunk.length && depth > 0) {
        const nextOpen = chunk.indexOf("<div", pos);
        const nextClose = chunk.indexOf("</div", pos);
        if (nextClose < 0) break;
        if (nextOpen >= 0 && nextOpen < nextClose) { depth++; pos = nextOpen + 4; }
        else { depth--; pos = nextClose + 5; }
      }
      const inner = chunk.slice(innerStart, pos - 5).trim();
      if (inner.replace(/<[^>]+>/g, "").trim()) sectionSummary = inner;
    }

    sections.push({ sectionId: `s${sectionIndex}`, sectionName, activities, ...(sectionSummary ? { summary: sectionSummary } : {}), ...(dataNumber !== undefined ? { dataNumber } : {}) });
    sectionIndex++;
  }

  return { courseId, sections };
}

/** Map a Moodle URL path to an activity type string. */
function activityTypeFromUrl(url: string): string {
  if (url.includes("/mod/url/")) return "url";
  if (url.includes("/mod/assign/")) return "assign";
  if (url.includes("/mod/forum/")) return "forum";
  if (url.includes("/mod/folder/")) return "folder";
  if (url.includes("/mod/page/")) return "page";
  if (url.includes("/mod/label/")) return "label";
  if (url.includes("/mod/quiz/")) return "quiz";
  if (url.includes("/mod/glossary/")) return "glossary";
  if (url.includes("/mod/grouptool/")) return "grouptool";
  if (url.includes("/mod/bigbluebuttonbn/")) return "bigbluebuttonbn";
  if (url.includes("/mod/resource/")) return "resource";
  return "resource";
}

/**
 * Parse a single Moodle activity `<li class="activity">` HTML fragment into an Activity.
 *
 * Expected HTML structure:
 *   <li class="activity resource modtype_resource" data-activityname="Lecture PDF" ...>
 *     <a href="https://moodle/mod/resource/view.php?id=10">
 *       Lecture PDF<span class="accesshide"> Datei</span>
 *     </a>
 *     <div class="activity-altcontent"><p>Description text...</p></div>
 *   </li>
 *
 * Returns null and logs a warning via `logger` when the element is null or malformed.
 * The caller (`parseContentTree`) silently skips null results.
 */
export function parseActivityFromElement(
  element: string | null,
  pageUrl: string,
  logger?: Logger,
): Activity | null {
  if (!element) {
    logger?.warn(`Unexpected page structure at ${pageUrl} — null element`);
    return null;
  }

  try {
    const linkMatch = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(element);
    const url = linkMatch?.[1] ?? "";
    const rawLinkHtml = linkMatch?.[2] ?? "";

    // Prefer the canonical data-activityname attribute (set by Moodle on the activity-item div).
    // This avoids mis-naming activities whose <li> contains links to other activities
    // (e.g. a customcert certificate li that links to the paired scorm activity by name).
    const dataNameMatch = /data-activityname="([^"]+)"/i.exec(element);
    let name: string;
    if (dataNameMatch?.[1]) {
      name = decodeHtmlEntities(dataNameMatch[1]!);
    } else if (rawLinkHtml) {
      // Strip accesshide spans before deriving name, then strip remaining tags, then decode entities
      name = decodeHtmlEntities(stripAccessHide(rawLinkHtml));
    } else {
      // Fall back to span text for restricted (no-link) activities
      const spanMatch = /<span[^>]*>([\s\S]*?)<\/span>/i.exec(element);
      name = spanMatch ? decodeHtmlEntities(stripAccessHide(spanMatch[1]!)) : "";
    }

    if (!name) name = "Unnamed activity";

    // Prefer modtype_xxx CSS class for type detection (more reliable than URL parsing).
    // Fall back to URL-based detection, then "label" for activities with no URL.
    const modtypeMatch = /\bmodtype_(\w+)\b/i.exec(element);
    const activityType = modtypeMatch
      ? modtypeMatch[1]!.toLowerCase()
      : (url ? activityTypeFromUrl(url) : "label");

    // Check accessibility: dimmed_text class indicates restricted — check attrs (before content)
    const attrsEnd = element.indexOf(">");
    const openTag = attrsEnd >= 0 ? element.slice(0, attrsEnd) : element;
    const isAccessible = !openTag.includes("dimmed_text") && !element.includes("dimmed_text");

    const resourceIdMatch = /data-resource-id="([^"]+)"/.exec(element);
    const hashMatch = /data-hash="([^"]+)"/.exec(element);

    // Extract activity-altcontent (label inline content or activity description sidecar).
    // The altcontent div contains nested divs (e.g. <div class="no-overflow"><div>...</div></div>),
    // so we can't use a simple non-greedy regex. Instead find the opening tag, then walk forward
    // counting open/close div tags to find the matching closing </div>.
    let description: string | undefined;
    const altcontentOpenRe = /<div[^>]+class="[^"]*activity-altcontent[^"]*"[^>]*>/i;
    const altcontentOpenMatch = altcontentOpenRe.exec(element);
    if (altcontentOpenMatch) {
      const innerStart = altcontentOpenMatch.index + altcontentOpenMatch[0].length;
      let depth = 1;
      let pos = innerStart;
      while (pos < element.length && depth > 0) {
        const nextOpen = element.indexOf("<div", pos);
        const nextClose = element.indexOf("</div", pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;
        } else {
          depth--;
          pos = nextClose + 5;
        }
      }
      const inner = element.slice(innerStart, pos - 5 /* back before </div */).trim();
      if (inner) description = inner;
    }

    return {
      activityType,
      activityName: name,
      url,
      isAccessible,
      ...(resourceIdMatch?.[1] ? { resourceId: resourceIdMatch[1] } : {}),
      ...(hashMatch?.[1] ? { hash: hashMatch[1] } : {}),
      ...(description ? { description } : {}),
    };
  } catch (err) {
    logger?.warn(`Unexpected page structure at ${pageUrl} — ${(err as Error).message}`);
    return null;
  }
}
