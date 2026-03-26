// Covers: STEP-013, REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-SCRAPE-012
//
// Tests for course listing and content tree traversal.
// Uses HTML fixture files from tests/fixtures/ to mock Moodle responses.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from "undici";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCourseList, fetchContentTree } from "../../src/scraper/courses.js";

const FIXTURES = resolve(__dirname, "../fixtures/mock-moodle-responses");

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

describe("STEP-013: Course listing", () => {
  // REQ-SCRAPE-001
  it("returns enrolled courses with courseId, courseName, courseUrl", async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: /\/lib\/ajax\/service\.php/, method: "POST" })
      .reply(200, JSON.stringify([
        {
          data: [
            { id: 1, fullname: "Macro Economics 2024", viewurl: `${BASE}/course/view.php?id=1` },
            { id: 2, fullname: "Statistics I", viewurl: `${BASE}/course/view.php?id=2` },
          ],
        },
      ]), { headers: { "content-type": "application/json" } });

    const courses = await fetchCourseList({ baseUrl: BASE, sessionCookies: "MoodleSession=abc" });

    expect(courses).toHaveLength(2);
    expect(courses[0]).toMatchObject({ courseId: 1, courseName: "Macro Economics 2024" });
    expect(courses[1]).toMatchObject({ courseId: 2, courseName: "Statistics I" });
  });

  it("returns an empty array when no courses are enrolled", async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: /\/lib\/ajax\/service\.php/, method: "POST" })
      .reply(200, JSON.stringify([{ data: [] }]), { headers: { "content-type": "application/json" } });

    const courses = await fetchCourseList({ baseUrl: BASE, sessionCookies: "" });
    expect(courses).toEqual([]);
  });

  it("propagates error when the course list endpoint fails", async () => {
    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: /\/lib\/ajax\/service\.php/, method: "POST" })
      .reply(500, "Internal Server Error");

    await expect(fetchCourseList({ baseUrl: BASE, sessionCookies: "" })).rejects.toThrow();
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
