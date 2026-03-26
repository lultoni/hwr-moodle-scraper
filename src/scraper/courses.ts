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

export async function fetchCourseList(opts: FetchOptions): Promise<Course[]> {
  const { baseUrl, sessionCookies } = opts;
  const { request } = await import("undici");

  const payload = JSON.stringify([{
    index: 0,
    methodname: "core_course_get_enrolled_courses_by_timeline_classification",
    args: { offset: 0, limit: 0, classification: "all", sort: "fullname" },
  }]);

  const { statusCode, body } = await request(`${baseUrl}/lib/ajax/service.php?sesskey=session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cookie": sessionCookies,
    },
    body: payload,
  });

  if (statusCode >= 400) throw new Error(`Course list fetch failed: HTTP ${statusCode}`);

  const json = await body.json() as Array<{ data: Array<{ id: number; fullname: string; viewurl: string }> }>;
  return (json[0]?.data ?? []).map((c) => ({
    courseId: c.id,
    courseName: c.fullname,
    courseUrl: c.viewurl,
  }));
}

export async function fetchContentTree(opts: FetchOptions & { courseId: number }): Promise<ContentTree> {
  const { baseUrl, courseId, sessionCookies } = opts;
  const { request } = await import("undici");

  const { statusCode, body } = await request(`${baseUrl}/course/view.php?id=${courseId}`, {
    method: "GET",
    headers: { cookie: sessionCookies },
  });

  if (statusCode >= 400) throw new Error(`Content tree fetch failed: HTTP ${statusCode}`);

  const html = await body.text();
  return parseContentTree(html, courseId, baseUrl);
}

function parseContentTree(html: string, courseId: number, baseUrl: string): ContentTree {
  const sections: Section[] = [];
  let sectionIndex = 0;

  // Split by section boundaries using a section header pattern
  // Moodle HTML: <li class="section ..."> ... <h3 class="sectionname">...</h3> ... activities ...
  // We split on section headers and process each chunk
  const sectionChunks = html.split(/<li[^>]+class="[^"]*\bsection\b[^"]*"/i);

  for (let i = 1; i < sectionChunks.length; i++) {
    const chunk = sectionChunks[i] ?? "";
    const nameMatch = /<h3[^>]+class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/h3>/i.exec(chunk);
    const sectionName = nameMatch
      ? nameMatch[1]!.replace(/<[^>]+>/g, "").trim()
      : `Section ${sectionIndex}`;

    const activities: Activity[] = [];

    // Find all activity items using an index-based approach to preserve the opening tag
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
    const rawName = (linkMatch?.[2] ?? "").replace(/<[^>]+>/g, "").trim();
    // Fall back to span text for restricted (no-link) activities
    const spanMatch = !rawName ? /<span[^>]*>([\s\S]*?)<\/span>/i.exec(element) : null;
    const name = rawName || (spanMatch?.[1] ?? "").replace(/<[^>]+>/g, "").trim() || "Unnamed activity";

    // Determine activity type from URL pattern
    let activityType = "resource";
    if (url.includes("/mod/url/")) activityType = "url";
    else if (url.includes("/mod/assign/")) activityType = "assign";
    else if (url.includes("/mod/forum/")) activityType = "forum";
    else if (url.includes("/mod/resource/")) activityType = "resource";

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
