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
}

export interface FolderFile {
  name: string;
  url: string;
}

export interface Section {
  sectionId: string;
  sectionName: string;
  activities: Activity[];
}

export interface ContentTree {
  courseId: number;
  sections: Section[];
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
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

/**
 * Parse onetopic-format tab nav to build sectionNumber → name map.
 * Matches: <li id="onetabid-NNN"...><a href="...section=N...">Name</a>
 */
function parseOnetopicTabs(html: string): Map<number, string> {
  const map = new Map<number, string>();
  const tabRe = /id="onetabid-\d+"[\s\S]*?href="[^"]*[?&]section=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = tabRe.exec(html)) !== null) {
    const sectionNum = parseInt(m[1]!, 10);
    const name = decodeHtmlEntities(m[2]!.replace(/<[^>]+>/g, "").trim());
    if (name && !map.has(sectionNum)) map.set(sectionNum, name);
  }
  return map;
}

/** Parse course search results page HTML into a Course list. */
function parseCourseSearchHtml(html: string, baseUrl: string): Course[] {
  const courses: Course[] = [];
  // Each course card: <div class="coursebox ..." data-courseid="NNNN">
  const cardRe = /data-courseid="(\d+)"[\s\S]*?class="coursename"[\s\S]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const courseId = parseInt(m[1]!, 10);
    const courseUrl = m[2]!;
    const rawName = m[3]!.replace(/<[^>]+>/g, "").trim();
    courses.push({ courseId, courseName: rawName, courseUrl });
  }
  return courses;
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

  const { statusCode, body } = await fetchWithRedirects(
    `${baseUrl}/course/view.php?id=${courseId}`,
    { cookie: sessionCookies },
  );

  if (statusCode >= 400) throw new Error(`Content tree fetch failed: HTTP ${statusCode}`);

  return parseContentTree(body, courseId, baseUrl, opts.logger);
}

/** Fetch a folder page and return all downloadable file links. */
export async function fetchFolderFiles(
  opts: FetchOptions & { folderUrl: string },
): Promise<FolderFile[]> {
  const { folderUrl, sessionCookies } = opts;

  const { statusCode, body } = await fetchWithRedirects(folderUrl, { cookie: sessionCookies });
  if (statusCode >= 400) return [];

  return parseFolderFiles(body);
}

function parseFolderFiles(html: string): FolderFile[] {
  const files: FolderFile[] = [];
  // Moodle folder pages list files with pluginfile.php links or forcedownload links
  const linkRe = /<a[^>]+href="([^"]*(?:pluginfile\.php|forcedownload)[^"]*)"[^>]*>[\s\S]*?<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const url = m[0]!;
    const href = m[1]!;
    // Extract filename from fp-filename span, or from URL
    const nameMatch = /<span[^>]+class="[^"]*fp-filename[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(url);
    const rawName = nameMatch
      ? nameMatch[1]!.replace(/<[^>]+>/g, "").trim()
      : decodeURIComponent(href.split("/").pop()?.split("?")[0] ?? "") || "file";
    files.push({ name: rawName, url: href });
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

    // 1. data-sectionname attribute (new Moodle)
    // 2. <h3 class="sectionname"> heading
    // 3. Onetopic tab nav (data-number → tab map)
    const dataNameMatch = /data-sectionname="([^"]+)"/i.exec(chunk);
    let sectionName: string;
    if (dataNameMatch) {
      sectionName = decodeHtmlEntities(dataNameMatch[1]!);
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

    sections.push({ sectionId: `s${sectionIndex}`, sectionName, activities });
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

    // Strip accesshide spans before deriving name, then strip remaining tags, then decode entities
    let name = rawLinkHtml
      ? decodeHtmlEntities(stripAccessHide(rawLinkHtml))
      : (() => {
          // Fall back to span text for restricted (no-link) activities
          const spanMatch = /<span[^>]*>([\s\S]*?)<\/span>/i.exec(element);
          return spanMatch ? decodeHtmlEntities(stripAccessHide(spanMatch[1]!)) : "";
        })() || "";

    // For labels (no URL): get name from data-activityname attribute
    if (!url && !name) {
      const dataNameMatch = /data-activityname="([^"]+)"/i.exec(element);
      if (dataNameMatch) name = decodeHtmlEntities(dataNameMatch[1]!);
    }

    if (!name) name = "Unnamed activity";

    const activityType = url ? activityTypeFromUrl(url) : "label";

    // Check accessibility: dimmed_text class indicates restricted — check attrs (before content)
    const attrsEnd = element.indexOf(">");
    const openTag = attrsEnd >= 0 ? element.slice(0, attrsEnd) : element;
    const isAccessible = !openTag.includes("dimmed_text") && !element.includes("dimmed_text");

    const resourceIdMatch = /data-resource-id="([^"]+)"/.exec(element);
    const hashMatch = /data-hash="([^"]+)"/.exec(element);

    // Extract activity-altcontent (label inline content or activity description sidecar)
    let description: string | undefined;
    const altcontentMatch = /<div[^>]+class="[^"]*activity-altcontent[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|$)/i.exec(element);
    if (altcontentMatch?.[1]?.trim()) {
      // Strip outer wrapper divs but keep inner HTML for turndown conversion
      description = altcontentMatch[1].trim();
    }

    return {
      activityType,
      activityName: name,
      url,
      isAccessible,
      resourceId: resourceIdMatch?.[1],
      hash: hashMatch?.[1],
      ...(description ? { description } : {}),
    };
  } catch (err) {
    logger?.warn(`Unexpected page structure at ${pageUrl} — ${(err as Error).message}`);
    return null;
  }
}
