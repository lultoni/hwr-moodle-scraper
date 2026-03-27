// REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-SCRAPE-012
export interface Course {
  courseId: number;
  courseName: string;
  courseUrl: string;
}

export interface Activity {
  activityType: string;
  activityName: string;
  url: string;
  isAccessible: boolean;
  resourceId?: string;
  hash?: string;
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
    const { statusCode, headers: resHeaders, body } = await request(currentUrl, {
      method: "GET",
      headers,
    });

    if (statusCode >= 300 && statusCode < 400) {
      const location = resHeaders["location"];
      if (!location) break;
      const loc = Array.isArray(location) ? location[0]! : location;
      // Resolve relative redirects
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).toString();
      await body.dump(); // drain to avoid memory leak
      continue;
    }

    const text = await body.text();
    return { statusCode, body: text, finalUrl: currentUrl };
  }

  // Exhausted redirects — return last response
  const { statusCode, body } = await request(currentUrl, { method: "GET", headers });
  return { statusCode, body: await body.text(), finalUrl: currentUrl };
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

  return parseContentTree(body, courseId, baseUrl);
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

function parseContentTree(html: string, courseId: number, baseUrl: string): ContentTree {
  const sections: Section[] = [];
  let sectionIndex = 0;

  // Split by section boundaries — handles both old (class="section") and new Moodle HTML
  // where the <li> tag spans multiple lines with data-sectionname attribute
  const sectionChunks = html.split(/<li[^>]+class="[^"]*\bsection\b[^"]*"/i);

  for (let i = 1; i < sectionChunks.length; i++) {
    const chunk = sectionChunks[i] ?? "";

    // Prefer data-sectionname attribute (new Moodle), fall back to <h3 class="sectionname">
    const dataNameMatch = /data-sectionname="([^"]+)"/i.exec(chunk);
    let sectionName: string;
    if (dataNameMatch) {
      sectionName = decodeHtmlEntities(dataNameMatch[1]!);
    } else {
      const h3Match = /<h[1-6][^>]+class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(chunk);
      sectionName = h3Match
        ? decodeHtmlEntities(h3Match[1]!.replace(/<[^>]+>/g, "").trim())
        : `Section ${sectionIndex}`;
    }

    const activities: Activity[] = [];

    // Find all activity items — <li class="activity ...">
    const activityOpenRe = /<li([^>]+class="[^"]*\bactivity\b[^"]*"[^>]*)>/gi;
    let actMatch: RegExpExecArray | null;
    while ((actMatch = activityOpenRe.exec(chunk)) !== null) {
      const attrs = actMatch[1] ?? "";
      const afterOpen = chunk.slice(actMatch.index);
      const result = parseActivityFromElement(
        attrs + afterOpen,
        `${baseUrl}/course/view.php?id=${courseId}`
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

export function parseActivityFromElement(
  element: string | null,
  pageUrl: string
): Activity | null {
  if (!element) {
    process.stderr.write(`Warning: unexpected page structure at ${pageUrl} — null element\n`);
    return null;
  }

  try {
    const linkMatch = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(element);
    const url = linkMatch?.[1] ?? "";
    const rawLinkHtml = linkMatch?.[2] ?? "";

    // Strip accesshide spans before deriving name, then strip remaining tags, then decode entities
    const name = rawLinkHtml
      ? decodeHtmlEntities(stripAccessHide(rawLinkHtml))
      : (() => {
          // Fall back to span text for restricted (no-link) activities
          const spanMatch = /<span[^>]*>([\s\S]*?)<\/span>/i.exec(element);
          return spanMatch ? decodeHtmlEntities(stripAccessHide(spanMatch[1]!)) : "";
        })() || "Unnamed activity";

    const activityType = activityTypeFromUrl(url);

    // Check accessibility: dimmed_text class indicates restricted — check attrs (before content)
    const attrsEnd = element.indexOf(">");
    const openTag = attrsEnd >= 0 ? element.slice(0, attrsEnd) : element;
    const isAccessible = !openTag.includes("dimmed_text") && !element.includes("dimmed_text");

    const resourceIdMatch = /data-resource-id="([^"]+)"/.exec(element);
    const hashMatch = /data-hash="([^"]+)"/.exec(element);

    return {
      activityType,
      activityName: name,
      url,
      isAccessible,
      resourceId: resourceIdMatch?.[1],
      hash: hashMatch?.[1],
    };
  } catch (err) {
    process.stderr.write(
      `Warning: unexpected page structure at ${pageUrl} — ${(err as Error).message}\n`
    );
    return null;
  }
}
