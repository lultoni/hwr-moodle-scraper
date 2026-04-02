// Covers: STEP-013, REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-SCRAPE-012
//
// Tests for course listing and content tree traversal.
// Uses HTML fixture files from tests/fixtures/ to mock Moodle responses.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from "undici";
import { fetchCourseList, fetchEnrolledCourses, fetchContentTree } from "../../src/scraper/courses.js";

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
  const DASHBOARD_HTML = `
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

  it("returns all enrolled courses from the Moodle dashboard page", async () => {
    mockAgent.get(BASE)
      .intercept({ path: /\/my\/courses\.php/, method: "GET" })
      .reply(200, DASHBOARD_HTML, { headers: { "content-type": "text/html" } });

    const courses = await fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "MoodleSession=abc" });

    expect(courses).toHaveLength(2);
    expect(courses[0]).toMatchObject({ courseId: 10, courseUrl: `${BASE}/course/view.php?id=10` });
    expect(courses[1]).toMatchObject({ courseId: 20, courseName: "Fachbereich Dokumentensammlung" });
  });

  it("returns empty array when dashboard has no course boxes", async () => {
    mockAgent.get(BASE)
      .intercept({ path: /\/my\/courses\.php/, method: "GET" })
      .reply(200, "<html><body><p>Welcome</p></body></html>", { headers: { "content-type": "text/html" } });

    const courses = await fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "" });
    expect(courses).toEqual([]);
  });

  it("throws when the dashboard endpoint returns an error", async () => {
    mockAgent.get(BASE)
      .intercept({ path: /\/my\/courses\.php/, method: "GET" })
      .reply(500, "Server Error");

    await expect(fetchEnrolledCourses({ baseUrl: BASE, sessionCookies: "" })).rejects.toThrow();
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
});
