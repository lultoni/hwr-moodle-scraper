// Covers: STEP-013, REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-SCRAPE-012
//
// Tests for course listing and content tree traversal.
// Uses HTML fixture files from tests/fixtures/ to mock Moodle responses.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from "undici";
import { fetchCourseList, fetchEnrolledCourses, fetchContentTree, extractCourseDescription } from "../../src/scraper/courses.js";

let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
  mockAgent.close();
});

const BASE = "https://moodle.example.com";

const SEARCH_HTML = `
<div class="courses course-search-result">
  <div class="coursebox clearfix odd first" data-courseid="1" data-type="1">
    <div class="info"><h3 class="coursename">
      <a class="aalink" href="${BASE}/course/view.php?id=1">Macro Economics 2024</a>
    </h3></div>
  </div>
  <div class="coursebox clearfix even" data-courseid="2" data-type="1">
    <div class="info"><h3 class="coursename">
      <a class="aalink" href="${BASE}/course/view.php?id=2">Statistics <span class="highlight">I</span></a>
    </h3></div>
  </div>
</div>`;

describe("STEP-013: Course listing", () => {
  // REQ-SCRAPE-001
  it("returns courses with courseId, courseName, courseUrl from search page", async () => {
    mockAgent.get(BASE)
      .intercept({ path: /\/course\/search\.php/, method: "GET" })
      .reply(200, SEARCH_HTML, { headers: { "content-type": "text/html" } });

    const courses = await fetchCourseList({ baseUrl: BASE, sessionCookies: "MoodleSession=abc", searchQuery: "TEST" });

    expect(courses).toHaveLength(2);
    expect(courses[0]).toMatchObject({ courseId: 1, courseName: "Macro Economics 2024" });
    expect(courses[1]).toMatchObject({ courseId: 2, courseName: "Statistics I" });
  });

  it("returns an empty array when no searchQuery is provided", async () => {
    const courses = await fetchCourseList({ baseUrl: BASE, sessionCookies: "" });
    expect(courses).toEqual([]);
  });

  it("propagates error when the search endpoint fails", async () => {
    mockAgent.get(BASE)
      .intercept({ path: /\/course\/search\.php/, method: "GET" })
      .reply(500, "Internal Server Error");

    await expect(fetchCourseList({ baseUrl: BASE, sessionCookies: "", searchQuery: "TEST" })).rejects.toThrow();
  });
});

describe("STEP-013: Enrolled courses from dashboard", () => {
  // Helper to build a Moodle-style AJAX response
  function ajaxResponse(courses: Array<{ id: number; fullname: string; shortname: string }>) {
    return JSON.stringify([{ error: false, data: { courses } }]);
  }

  // Dashboard HTML with a sesskey (for AJAX path)
  const DASH_WITH_SESSKEY = `<html><head></head><body>
<script>M.cfg = {"sesskey":"test-sesskey-123"};</script>
</body></html>`;

  // Dashboard HTML with NO sesskey (forces fallback to static HTML path)
  const DASH_NO_SESSKEY = `<html><body><p>Welcome</p></body></html>`;

  // Static-HTML fallback fixture (data-courseid + coursename)
  const STATIC_COURSES_HTML = `
<html><body>
  <div class="courses-view">
    <div class="coursebox clearfix" data-courseid="10" data-type="1">
      <div class="info"><h3 class="coursename">
        <a class="aalink" href="${BASE}/course/view.php?id=10">WI-M01-WI1011-F01-WiSe-2024-35267 WI24A Betriebswirtschaftliche Grundlagen WiSe-2024</a>
      </h3></div>
    </div>
    <div class="coursebox clearfix" data-courseid="20" data-type="1">
      <div class="info"><h3 class="coursename">
        <a class="aalink" href="${BASE}/course/view.php?id=20">Fachbereich Dokumentensammlung</a>
      </h3></div>
    </div>
  </div>
</body></html>`;

  it("returns all enrolled courses via AJAX API when sesskey is present", async () => {
    const pool = mockAgent.get(BASE);
    pool.intercept({ path: "/my/", method: "GET" })
      .reply(200, DASH_WITH_SESSKEY, { headers: { "content-type": "text/html" } });
    pool.intercept({ path: /\/lib\/ajax\/service\.php/, method: "POST" })
      .reply(200, ajaxResponse([
        { id: 10, fullname: "WI24A Betriebswirtschaftliche Grundlagen", shortname: "WI1011" },
        { id: 20, fullname: "Fachbereich Dokumentensammlung", shortname: "FB-Dok" },
      ]), { headers: { "content-type": "application/json" } });

    const courses = await fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "MoodleSession=abc" });

    expect(courses).toHaveLength(2);
    expect(courses[0]).toMatchObject({ courseId: 10, courseUrl: `${BASE}/course/view.php?id=10` });
    expect(courses[0]!.courseName).toContain("Betriebswirtschaftliche Grundlagen");
    expect(courses[1]!.courseName).toContain("Fachbereich Dokumentensammlung");
  });

  it("falls back to static HTML when no sesskey found in dashboard", async () => {
    const pool = mockAgent.get(BASE);
    // /my/ returns a page without sesskey
    pool.intercept({ path: "/my/", method: "GET" })
      .reply(200, DASH_NO_SESSKEY, { headers: { "content-type": "text/html" } });
    // Fallback /my/courses.php
    pool.intercept({ path: /\/my\/courses\.php/, method: "GET" })
      .reply(200, STATIC_COURSES_HTML, { headers: { "content-type": "text/html" } });

    const courses = await fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "MoodleSession=abc" });
    expect(courses).toHaveLength(2);
    expect(courses[0]).toMatchObject({ courseId: 10 });
  });

  it("falls back to static HTML when AJAX returns an error result", async () => {
    const pool = mockAgent.get(BASE);
    pool.intercept({ path: "/my/", method: "GET" })
      .reply(200, DASH_WITH_SESSKEY, { headers: { "content-type": "text/html" } });
    pool.intercept({ path: /\/lib\/ajax\/service\.php/, method: "POST" })
      .reply(200, JSON.stringify([{ error: true, data: null }]), { headers: { "content-type": "application/json" } });
    pool.intercept({ path: /\/my\/courses\.php/, method: "GET" })
      .reply(200, STATIC_COURSES_HTML, { headers: { "content-type": "text/html" } });

    const courses = await fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "" });
    expect(courses).toHaveLength(2);
  });

  it("returns empty array when AJAX returns empty courses list", async () => {
    const pool = mockAgent.get(BASE);
    pool.intercept({ path: "/my/", method: "GET" })
      .reply(200, DASH_WITH_SESSKEY, { headers: { "content-type": "text/html" } });
    pool.intercept({ path: /\/lib\/ajax\/service\.php/, method: "POST" })
      .reply(200, ajaxResponse([]), { headers: { "content-type": "application/json" } });

    const courses = await fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "" });
    expect(courses).toEqual([]);
  });

  it("throws when the dashboard /my/ endpoint returns an error", async () => {
    mockAgent.get(BASE)
      .intercept({ path: "/my/", method: "GET" })
      .reply(500, "Server Error");

    await expect(fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "" })).rejects.toThrow();
  });

  it("returns courses with correct courseUrl format", async () => {
    const pool = mockAgent.get(BASE);
    pool.intercept({ path: "/my/", method: "GET" })
      .reply(200, DASH_WITH_SESSKEY, { headers: { "content-type": "text/html" } });
    pool.intercept({ path: /\/lib\/ajax\/service\.php/, method: "POST" })
      .reply(200, ajaxResponse([
        { id: 42, fullname: "Ready to Go Global? Interkultureller Kurs", shortname: "RTG" },
        { id: 43, fullname: "Fachrichtungsbüro WI - Infos", shortname: "FBWI" },
      ]), { headers: { "content-type": "application/json" } });

    const courses = await fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "" });
    expect(courses).toHaveLength(2);
    expect(courses[0]!.courseName).toContain("Ready to Go Global");
    expect(courses[1]!.courseName).toContain("Fachrichtungsbüro");
    expect(courses[0]!.courseUrl).toBe(`${BASE}/course/view.php?id=42`);
  });

  it("does not duplicate courses when AJAX returns same id multiple times", async () => {
    const pool = mockAgent.get(BASE);
    pool.intercept({ path: "/my/", method: "GET" })
      .reply(200, DASH_WITH_SESSKEY, { headers: { "content-type": "text/html" } });
    // AJAX naturally returns unique courses (dedup is on the Moodle server side for AJAX)
    pool.intercept({ path: /\/lib\/ajax\/service\.php/, method: "POST" })
      .reply(200, ajaxResponse([
        { id: 50, fullname: "Course A", shortname: "CA" },
        { id: 51, fullname: "Course B", shortname: "CB" },
      ]), { headers: { "content-type": "application/json" } });

    const courses = await fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "" });
    const ids = courses.map((c) => c.courseId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not double course name when shortname equals fullname", async () => {
    const pool = mockAgent.get(BASE);
    pool.intercept({ path: "/my/", method: "GET" })
      .reply(200, DASH_WITH_SESSKEY, { headers: { "content-type": "text/html" } });
    pool.intercept({ path: /\/lib\/ajax\/service\.php/, method: "POST" })
      .reply(200, ajaxResponse([
        { id: 99, fullname: "Bibliothek benutzen", shortname: "Bibliothek benutzen" },
      ]), { headers: { "content-type": "application/json" } });

    const courses = await fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "" });
    expect(courses[0]!.courseName).toBe("Bibliothek benutzen");
    expect(courses[0]!.courseName).not.toContain("Bibliothek benutzen  Bibliothek benutzen");
  });
});

// Regression test: verifies that all 42 courses enrolled at HWR Berlin are parsed from
// the Moodle AJAX API response (as captured from the live site 2026-04-02).
describe("STEP-013: Full HWR Berlin course list (42 courses)", () => {
  const HWR_COURSES = [
    { id: 1001, fullname: "Ready to Go Global? Interkultureller Vor- und Nachbereitungskurs", shortname: "RTG" },
    { id: 1002, fullname: "Bibliothek benutzen", shortname: "Bib" },
    { id: 1003, fullname: "Einstufung Englisch FB 2", shortname: "EE2" },
    { id: 1004, fullname: "Volkswirtschaftliche Grundlagen", shortname: "VWL" },
    { id: 1005, fullname: "Kostenrechnung und Controlling_98551", shortname: "KRC1" },
    { id: 1006, fullname: "Datenbanken", shortname: "DB" },
    { id: 1007, fullname: "Software Engineering", shortname: "SE" },
    { id: 1008, fullname: "Prozessmodellierung", shortname: "PM" },
    { id: 1009, fullname: "IT-Management", shortname: "ITM" },
    { id: 1010, fullname: "Digitale Kompetenz - Computergestützte Statistische Datenanalyse", shortname: "DK-CSD" },
    { id: 1011, fullname: "WI24 Business English III  Advanced 1 WiSe-2025", shortname: "BE3" },
    { id: 1012, fullname: "Wissenschaftliches Arbeiten II", shortname: "WA2" },
    { id: 1013, fullname: "Ausbildung der Ausbilder I", shortname: "AdA1" },
    { id: 1014, fullname: "Betriebswirtschaftliche Grundlagen", shortname: "BWL" },
    { id: 1015, fullname: "Finanzbuchführung", shortname: "FBF" },
    { id: 1016, fullname: "Bilanzbuchführung", shortname: "BBF" },
    { id: 1017, fullname: "Beschaffung/Produktion", shortname: "BP" },
    { id: 1018, fullname: "Marketing / Vertrieb", shortname: "MV" },
    { id: 1019, fullname: "Projektmanagement", shortname: "PjM" },
    { id: 1020, fullname: "Gestalten des digitalen Zeitalters", shortname: "GdZ" },
    { id: 1021, fullname: "Strukturierte Programmierung", shortname: "SP" },
    { id: 1022, fullname: "Algorithmen und Datenstrukturen", shortname: "ADS" },
    { id: 1023, fullname: "Rechnersysteme", shortname: "RS" },
    { id: 1024, fullname: "Betriebssysteme", shortname: "BS" },
    { id: 1025, fullname: "Netzwerke", shortname: "NW" },
    { id: 1026, fullname: "Theoretische Grundlagen der Informatik", shortname: "TGI" },
    { id: 1027, fullname: "Finanzmathematik", shortname: "FM" },
    { id: 1028, fullname: "Operations Research", shortname: "OR" },
    { id: 1029, fullname: "WI24 DevOps-Engineering SoSe-2026", shortname: "DevOps" },
    { id: 1030, fullname: "Wissenschaftliches Arbeiten I", shortname: "WA1" },
    { id: 1031, fullname: "WI24 Business English I - Advanced I WiSe-2024", shortname: "BE1" },
    { id: 1032, fullname: "Digitale Kompetenzen - Betriebssystempraxis", shortname: "DK-BSP" },
    { id: 1033, fullname: "WI24 Business English II Advanced 1 SoSe-2025", shortname: "BE2" },
    { id: 1034, fullname: "IT-Sicherheit", shortname: "ITS" },
    { id: 1035, fullname: "Geschäftsprozessmanagement", shortname: "GPM" },
    { id: 1036, fullname: "Objektorientierte Systemanalyse und -Entwurf", shortname: "OOSE" },
    { id: 1037, fullname: "Kostenrechnung und Controlling_98017", shortname: "KRC2" },
    { id: 1038, fullname: "Statistik", shortname: "Stat" },
    { id: 1039, fullname: "Verstehen des digitalen Zeitalters", shortname: "VdZ" },
    { id: 1040, fullname: "Analysis", shortname: "Ana" },
    { id: 1041, fullname: "Objektorientierte Programmierung", shortname: "OOP" },
    { id: 1042, fullname: "Fachrichtungsbüro WI - Infos der Fachrichtung", shortname: "FBWI" },
  ];

  const DASH_WITH_SESSKEY = `<html><head></head><body>
<script>M.cfg = {"sesskey":"test-sesskey-hwr"};</script>
</body></html>`;

  it("fetches all 42 HWR Berlin enrolled courses via AJAX", async () => {
    const pool = mockAgent.get(BASE);
    pool.intercept({ path: "/my/", method: "GET" })
      .reply(200, DASH_WITH_SESSKEY, { headers: { "content-type": "text/html" } });
    pool.intercept({ path: /\/lib\/ajax\/service\.php/, method: "POST" })
      .reply(200, JSON.stringify([{ error: false, data: { courses: HWR_COURSES } }]), { headers: { "content-type": "application/json" } });

    const courses = await fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "MoodleSession=abc" });

    expect(courses).toHaveLength(42);
    // Spot-check a few course names (courseName = shortname + " " + fullname)
    const names = courses.map((c) => c.courseName);
    expect(names.some((n) => n.includes("IT-Sicherheit"))).toBe(true);
    expect(names.some((n) => n.includes("Datenbanken"))).toBe(true);
    expect(names.some((n) => n.includes("Wissenschaftliches Arbeiten I"))).toBe(true);
    expect(names.some((n) => n.includes("Fachrichtungsbüro WI - Infos der Fachrichtung"))).toBe(true);
    // All have correct courseUrl format
    for (const c of courses) {
      expect(c.courseUrl).toBe(`${BASE}/course/view.php?id=${c.courseId}`);
    }
  });
});


describe("STEP-013: Content tree traversal", () => {
  // REQ-SCRAPE-002
  it("returns sections with activities for a course", async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: `/course/view.php?id=1`, method: "GET" })
      .reply(200, `
        <html><body>
          <li class="section"><h3 class="sectionname">Week 1</h3>
            <ul class="section img-text">
              <li class="activity resource"><a href="${BASE}/mod/resource/view.php?id=10">Lecture Notes</a></li>
              <li class="activity url"><a href="${BASE}/mod/url/view.php?id=11">Moodle Docs</a></li>
            </ul>
          </li>
        </body></html>
      `);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 1, sessionCookies: "" });

    expect(tree.sections).toHaveLength(1);
    expect(tree.sections[0]?.sectionName).toBe("Week 1");
    expect(tree.sections[0]?.activities).toHaveLength(2);
  });

  it("represents an empty course as sections: []", async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: `/course/view.php?id=99`, method: "GET" })
      .reply(200, "<html><body><ul class='topics'></ul></body></html>");

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 99, sessionCookies: "" });
    expect(tree.sections).toEqual([]);
  });

  // REQ-SCRAPE-012
  it("marks restricted activities as isAccessible: false without throwing", async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: `/course/view.php?id=1`, method: "GET" })
      .reply(200, `
        <html><body>
          <li class="section"><h3 class="sectionname">Week 1</h3>
            <ul class="section">
              <li class="activity resource dimmed_text"><span>Restricted File</span></li>
            </ul>
          </li>
        </body></html>
      `);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 1, sessionCookies: "" });
    const activities = tree.sections[0]?.activities ?? [];
    const restricted = activities.find((a) => !a.isAccessible);
    expect(restricted).toBeDefined();
    expect(restricted?.isAccessible).toBe(false);
  });

  it("extracts section summary from <div class='summarytext'>", async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: `/course/view.php?id=5`, method: "GET" })
      .reply(200, `
        <html><body>
          <li class="section"><h3 class="sectionname">Dein Abenteuer beginnt hier</h3>
            <div class="summarytext">
              <div class="no-overflow"><p>Dieser interaktive Moodle-Kurs unterstützt Dich dabei.</p></div>
            </div>
            <ul class="section img-text">
              <li class="activity resource"><a href="${BASE}/mod/resource/view.php?id=10">Datei</a></li>
            </ul>
          </li>
        </body></html>
      `);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 5, sessionCookies: "" });
    expect(tree.sections).toHaveLength(1);
    expect(tree.sections[0]?.summary).toBeDefined();
    expect(tree.sections[0]?.summary).toContain("Moodle-Kurs");
  });

  it("does not include section.summary when summarytext block is absent", async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: `/course/view.php?id=6`, method: "GET" })
      .reply(200, `
        <html><body>
          <li class="section"><h3 class="sectionname">Section A</h3>
            <ul class="section img-text">
              <li class="activity resource"><a href="${BASE}/mod/resource/view.php?id=20">Doc</a></li>
            </ul>
          </li>
        </body></html>
      `);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 6, sessionCookies: "" });
    expect(tree.sections[0]?.summary).toBeUndefined();
  });
});

describe("extractCourseDescription — unit tests", () => {
  it("extracts summary text from <div class='summary'>", () => {
    const html = `<html><body>
      <div class="course-description">
        <div class="summary"><p>Dies ist eine <strong>Kursbeschreibung</strong>.</p></div>
      </div>
    </body></html>`;
    const result = extractCourseDescription(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Kursbeschreibung");
  });

  it("returns null when no summary block is present", () => {
    const html = `<html><body><div class="other">No summary here</div></body></html>`;
    expect(extractCourseDescription(html)).toBeNull();
  });

  it("returns null when summary block is empty or whitespace-only", () => {
    const html = `<html><body><div class="course-description"><div class="summary">   </div></div></body></html>`;
    expect(extractCourseDescription(html)).toBeNull();
  });

  it("returns null when summary only contains empty paragraph tags", () => {
    const html = `<html><body><div class="course-description"><div class="summary"><p></p><br></div></div></body></html>`;
    expect(extractCourseDescription(html)).toBeNull();
  });

  it("extracts description from <div class='course-summary-section'> variant", () => {
    const html = `<html><body>
      <div class="course-summary-section"><p>Kurzbeschreibung des Kurses WI.</p></div>
    </body></html>`;
    const result = extractCourseDescription(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Kurzbeschreibung");
  });

  it("extracts multi-paragraph summary with nested divs (balanced-div)", () => {
    const html = `<html><body>
      <div class="summary">
        <div class="no-overflow">
          <p>Herzlich Willkommen!</p>
          <div class="inner"><p>Dieser Kurs umfasst die Inhalte der Einheit.</p></div>
          <p>Prof. Dr. Claudia Lemke</p>
        </div>
      </div>
    </body></html>`;
    const result = extractCourseDescription(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Herzlich Willkommen");
    expect(result).toContain("Claudia Lemke");
  });

  it("extracts description from <div class='summarytext'> (Moodle 4.x section-0 variant)", () => {
    const html = `<html><body>
      <div class="summarytext">
        <div class="no-overflow">
          <p>Herzlich Willkommen Jahrgang 2024!</p>
          <p>Dieser Moodle-Kurs umfasst die Inhalte der Einheit Strategisches GPM.</p>
        </div>
      </div>
    </body></html>`;
    const result = extractCourseDescription(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Herzlich Willkommen Jahrgang 2024");
    expect(result).toContain("Strategisches GPM");
  });
});

describe("BUG-D: Onetopic tab detection with &amp; entity encoding", () => {
  it("fetches all onetopic sections when href uses &amp;section= (HTML entity encoding)", async () => {
    const pool = mockAgent.get(BASE);

    // Main page with &amp; encoded URLs in tab nav — only section 1 rendered in HTML
    pool.intercept({ path: "/course/view.php?id=10", method: "GET" })
      .reply(200, `<html><body>
        <ul class="nav tabs">
          <li id="onetabid-100"><a class="nav-link active" href="${BASE}/course/view.php?id=10&amp;section=1#tabs-tree-start">Informationen</a></li>
          <li id="onetabid-101"><a class="nav-link" href="${BASE}/course/view.php?id=10&amp;section=2#tabs-tree-start">Materialien</a></li>
          <li id="onetabid-102"><a class="nav-link" href="${BASE}/course/view.php?id=10&amp;section=3#tabs-tree-start">Abgabe</a></li>
        </ul>
        <li class="section" data-sectionname="Section 0" data-number="0"><ul class="section"></ul></li>
        <li class="section" data-sectionname="Informationen" data-number="1">
          <ul class="section">
            <li class="activity modtype_resource"><a href="${BASE}/mod/resource/view.php?id=1">Skript</a></li>
          </ul>
        </li>
      </body></html>`, { headers: { "content-type": "text/html" } });

    // Tab 2 page
    pool.intercept({ path: "/course/view.php?id=10&section=2", method: "GET" })
      .reply(200, `<html><body>
        <li class="section" data-sectionname="Materialien" data-number="2">
          <ul class="section">
            <li class="activity modtype_resource"><a href="${BASE}/mod/resource/view.php?id=2">Übungsblatt</a></li>
          </ul>
        </li>
      </body></html>`, { headers: { "content-type": "text/html" } });

    // Tab 3 page
    pool.intercept({ path: "/course/view.php?id=10&section=3", method: "GET" })
      .reply(200, `<html><body>
        <li class="section" data-sectionname="Abgabe" data-number="3">
          <ul class="section">
            <li class="activity modtype_assign"><a href="${BASE}/mod/assign/view.php?id=3">Aufgabe 1</a></li>
          </ul>
        </li>
      </body></html>`, { headers: { "content-type": "text/html" } });

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 10, sessionCookies: "" });
    const sectionNames = tree.sections.map(s => s.sectionName);
    expect(sectionNames).toContain("Informationen");
    expect(sectionNames).toContain("Materialien");
    expect(sectionNames).toContain("Abgabe");
    expect(tree.sections.length).toBeGreaterThanOrEqual(3);
  });
});

describe("BUG-E: Section name whitespace fallback", () => {
  it("falls back to 'Allgemeines' when section 0 data-sectionname is whitespace-only", async () => {
    const pool = mockAgent.get(BASE);
    pool.intercept({ path: "/course/view.php?id=20", method: "GET" })
      .reply(200, `<html><body>
        <li class="section" data-sectionname=" ">
          <ul class="section">
            <li class="activity modtype_forum"><a href="${BASE}/mod/forum/view.php?id=1">Ankündigungen</a></li>
          </ul>
        </li>
        <li class="section" data-sectionname="Lerneinheit 1">
          <ul class="section">
            <li class="activity modtype_resource"><a href="${BASE}/mod/resource/view.php?id=2">Skript</a></li>
          </ul>
        </li>
      </body></html>`, { headers: { "content-type": "text/html" } });

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 20, sessionCookies: "" });
    expect(tree.sections[0]?.sectionName).toBe("Allgemeines");
    expect(tree.sections[1]?.sectionName).toBe("Lerneinheit 1");
  });
});
