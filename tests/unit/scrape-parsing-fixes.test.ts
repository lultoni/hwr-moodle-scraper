// Covers: STEP-013-fix, REQ-SCRAPE-002, REQ-SCRAPE-012
//
// Tests for parsing fixes:
// 1. Redirect following in fetchContentTree
// 2. accesshide span text stripped from activity names
// 3. All modtypes recognised (folder, page, label, quiz, glossary, grouptool, bigbluebuttonbn)
// 4. Folder expansion — fetch folder page and enumerate files
// 5. Real Moodle HTML structure (multiline <li> tags, data-sectionname attribute)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from "undici";
import { fetchContentTree, parseActivityFromElement } from "../../src/scraper/courses.js";


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

// Minimal real-world Moodle course HTML (based on actual HWR Moodle structure)
const REAL_COURSE_HTML = `
<html><body>
<ul class="topics section-list" data-for="course_sectionlist">
  <li id="section-0"
      class="section course-section main  clearfix
               "
      data-sectionid="0"
      data-for="section"
      data-sectionname="Allgemeines"
  >
    <div class="section-item">
      <h3 class="h4 sectionname course-content-item"><a href="#">Allgemeines</a></h3>
      <ul class="section m-0 p-0" data-for="cmlist">
        <li
            class="activity forum modtype_forum   "
            id="module-100"
            data-for="cmitem"
            data-id="100"
        >
          <div class="activity-item" data-activityname="Ankündigungen">
            <div class="activityname">
              <a href="${BASE}/mod/forum/view.php?id=100" class=" aalink stretched-link">
                <span class="instancename">Ankündigungen <span class="accesshide" > Forum</span></span>
              </a>
            </div>
          </div>
        </li>
        <li
            class="activity resource modtype_resource   "
            id="module-200"
            data-for="cmitem"
            data-id="200"
        >
          <div class="activity-item" data-activityname="Terminplan">
            <div class="activityname">
              <a href="${BASE}/mod/resource/view.php?id=200" class=" aalink stretched-link">
                <span class="instancename">Terminplan <span class="accesshide" > Datei</span></span>
              </a>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </li>
  <li id="section-1"
      class="section course-section main  clearfix"
      data-sectionid="1"
      data-for="section"
      data-sectionname="Unterlagen"
  >
    <div class="section-item">
      <h3 class="h4 sectionname course-content-item"><a href="#">Unterlagen</a></h3>
      <ul class="section m-0 p-0" data-for="cmlist">
        <li
            class="activity folder modtype_folder   "
            id="module-300"
            data-for="cmitem"
            data-id="300"
        >
          <div class="activity-item" data-activityname="Vorlesungsfolien">
            <div class="activityname">
              <a href="${BASE}/mod/folder/view.php?id=300" class=" aalink stretched-link">
                <span class="instancename">Vorlesungsfolien <span class="accesshide" > Verzeichnis</span></span>
              </a>
            </div>
          </div>
        </li>
        <li
            class="activity page modtype_page   "
            id="module-400"
            data-for="cmitem"
            data-id="400"
        >
          <div class="activity-item" data-activityname="Kursübersicht">
            <div class="activityname">
              <a href="${BASE}/mod/page/view.php?id=400" class=" aalink stretched-link">
                <span class="instancename">Kursübersicht <span class="accesshide" > Textseite</span></span>
              </a>
            </div>
          </div>
        </li>
        <li
            class="activity url modtype_url   "
            id="module-500"
            data-for="cmitem"
            data-id="500"
        >
          <div class="activity-item" data-activityname="Externes Dokument">
            <div class="activityname">
              <a href="${BASE}/mod/url/view.php?id=500" class=" aalink stretched-link">
                <span class="instancename">Externes Dokument <span class="accesshide" > URL</span></span>
              </a>
            </div>
          </div>
        </li>
        <li
            class="activity assign modtype_assign   "
            id="module-600"
            data-for="cmitem"
            data-id="600"
        >
          <div class="activity-item" data-activityname="Abgabe 1">
            <div class="activityname">
              <a href="${BASE}/mod/assign/view.php?id=600" class=" aalink stretched-link">
                <span class="instancename">Abgabe 1 <span class="accesshide" > Aufgabe</span></span>
              </a>
            </div>
          </div>
        </li>
        <li
            class="activity quiz modtype_quiz   "
            id="module-700"
            data-for="cmitem"
            data-id="700"
        >
          <div class="activity-item" data-activityname="Test 1">
            <div class="activityname">
              <a href="${BASE}/mod/quiz/view.php?id=700" class=" aalink stretched-link">
                <span class="instancename">Test 1 <span class="accesshide" > Test</span></span>
              </a>
            </div>
          </div>
        </li>
        <li
            class="activity glossary modtype_glossary   "
            id="module-800"
            data-for="cmitem"
            data-id="800"
        >
          <div class="activity-item" data-activityname="Glossar">
            <div class="activityname">
              <a href="${BASE}/mod/glossary/view.php?id=800" class=" aalink stretched-link">
                <span class="instancename">Glossar <span class="accesshide" > Glossar</span></span>
              </a>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </li>
</ul>
</body></html>`;

describe("Parsing: Real Moodle HTML structure (multiline section li, data-sectionname)", () => {
  it("parses sections using data-sectionname and real multiline <li> structure", async () => {
    mockAgent.get(BASE)
      .intercept({ path: `/course/view.php?id=1`, method: "GET" })
      .reply(200, REAL_COURSE_HTML);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 1, sessionCookies: "" });

    expect(tree.sections).toHaveLength(2);
    expect(tree.sections[0]?.sectionName).toBe("Allgemeines");
    expect(tree.sections[1]?.sectionName).toBe("Unterlagen");
  });

  it("strips accesshide spans from activity names", async () => {
    mockAgent.get(BASE)
      .intercept({ path: `/course/view.php?id=1`, method: "GET" })
      .reply(200, REAL_COURSE_HTML);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 1, sessionCookies: "" });

    // Names must NOT contain "Datei", "Forum", "Verzeichnis", "Textseite", "URL", "Aufgabe", "Test", "Glossar"
    const allNames = tree.sections.flatMap((s) => s.activities.map((a) => a.activityName));
    expect(allNames).toContain("Ankündigungen");
    expect(allNames).toContain("Terminplan");
    expect(allNames).toContain("Vorlesungsfolien");
    expect(allNames).toContain("Kursübersicht");
    // Ensure the German type suffixes (accesshide text) are NOT standalone at end of name
    for (const name of allNames) {
      expect(name).not.toMatch(/\s+(Datei|Forum|Verzeichnis|Textseite|Aufgabe|Glossar)$/);
    }
  });

  it("recognises all modtypes: forum, resource, folder, page, url, assign, quiz, glossary", async () => {
    mockAgent.get(BASE)
      .intercept({ path: `/course/view.php?id=1`, method: "GET" })
      .reply(200, REAL_COURSE_HTML);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 1, sessionCookies: "" });

    const types = tree.sections.flatMap((s) => s.activities.map((a) => a.activityType));
    expect(types).toContain("forum");
    expect(types).toContain("resource");
    expect(types).toContain("folder");
    expect(types).toContain("page");
    expect(types).toContain("url");
    expect(types).toContain("assign");
    expect(types).toContain("quiz");
    expect(types).toContain("glossary");
  });
});

describe("Parsing: Redirect following in fetchContentTree", () => {
  it("follows a 302 redirect from course/view.php to the actual content page", async () => {
    const pool = mockAgent.get(BASE);
    // First request redirects
    pool
      .intercept({ path: `/course/view.php?id=42`, method: "GET" })
      .reply(302, "", { headers: { location: `${BASE}/course/view.php?id=42&section=0` } });
    // Redirect target returns content
    pool
      .intercept({ path: `/course/view.php?id=42&section=0`, method: "GET" })
      .reply(200, `
        <html><body>
          <li class="section" data-sectionname="Week 1">
            <h3 class="sectionname">Week 1</h3>
            <ul class="section">
              <li class="activity resource" id="module-1"><a href="${BASE}/mod/resource/view.php?id=1">Lecture</a></li>
            </ul>
          </li>
        </body></html>
      `);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 42, sessionCookies: "" });
    expect(tree.sections).toHaveLength(1);
    expect(tree.sections[0]?.activities).toHaveLength(1);
  });
});

describe("Parsing: parseActivityFromElement — accesshide stripping", () => {
  it("strips the accesshide span text from activity name", () => {
    const element = `
      class="activity resource modtype_resource"
      id="module-200"
    >
      <div class="activityname">
        <a href="https://moodle.example.com/mod/resource/view.php?id=200">
          <span class="instancename">Terminplan <span class="accesshide"> Datei</span></span>
        </a>
      </div>
    `;
    const result = parseActivityFromElement(element, "https://moodle.example.com/course/view.php?id=1");
    expect(result?.activityName).toBe("Terminplan");
    expect(result?.activityType).toBe("resource");
  });

  it("strips accesshide from forum activity name", () => {
    const element = `
      class="activity forum modtype_forum"
    >
      <div class="activityname">
        <a href="https://moodle.example.com/mod/forum/view.php?id=100">
          <span class="instancename">Ankündigungen <span class="accesshide"> Forum</span></span>
        </a>
      </div>
    `;
    const result = parseActivityFromElement(element, "https://moodle.example.com/course/view.php?id=1");
    expect(result?.activityName).toBe("Ankündigungen");
    expect(result?.activityType).toBe("forum");
  });

  it("detects folder modtype from URL", () => {
    const element = `
      class="activity folder modtype_folder"
    >
      <div class="activityname">
        <a href="https://moodle.example.com/mod/folder/view.php?id=300">
          <span class="instancename">Vorlesungsfolien <span class="accesshide"> Verzeichnis</span></span>
        </a>
      </div>
    `;
    const result = parseActivityFromElement(element, "https://moodle.example.com/course/view.php?id=1");
    expect(result?.activityType).toBe("folder");
    expect(result?.activityName).toBe("Vorlesungsfolien");
  });

  it("detects page modtype from URL", () => {
    const element = `
      class="activity page modtype_page"
    >
      <a href="https://moodle.example.com/mod/page/view.php?id=400">
        <span class="instancename">Kursübersicht <span class="accesshide"> Textseite</span></span>
      </a>
    `;
    const result = parseActivityFromElement(element, "https://moodle.example.com/course/view.php?id=1");
    expect(result?.activityType).toBe("page");
    expect(result?.activityName).toBe("Kursübersicht");
  });

  it("detects quiz modtype from URL", () => {
    const element = `
      class="activity quiz modtype_quiz"
    >
      <a href="https://moodle.example.com/mod/quiz/view.php?id=700">
        <span class="instancename">Test 1 <span class="accesshide"> Test</span></span>
      </a>
    `;
    const result = parseActivityFromElement(element, "https://moodle.example.com/course/view.php?id=1");
    expect(result?.activityType).toBe("quiz");
  });

  it("detects glossary modtype from URL", () => {
    const element = `
      class="activity glossary modtype_glossary"
    >
      <a href="https://moodle.example.com/mod/glossary/view.php?id=800">
        <span class="instancename">Glossar <span class="accesshide"> Glossar</span></span>
      </a>
    `;
    const result = parseActivityFromElement(element, "https://moodle.example.com/course/view.php?id=1");
    expect(result?.activityType).toBe("glossary");
  });
});

describe("Parsing: Folder expansion", () => {
  it("fetchFolderFiles returns list of downloadable files from folder page", async () => {
    const { fetchFolderFiles } = await import("../../src/scraper/courses.js");

    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: `/mod/folder/view.php?id=300`, method: "GET" })
      .reply(200, `
        <html><body>
          <div class="fp-content">
            <div class="fp-filename-icon">
              <a href="${BASE}/pluginfile.php/12345/mod_folder/content/0/lecture1.pdf">
                <span class="fp-filename">lecture1.pdf</span>
              </a>
            </div>
            <div class="fp-filename-icon">
              <a href="${BASE}/pluginfile.php/12345/mod_folder/content/0/lecture2.pdf">
                <span class="fp-filename">lecture2.pdf</span>
              </a>
            </div>
          </div>
        </body></html>
      `);

    const files = await fetchFolderFiles({
      baseUrl: BASE,
      folderUrl: `${BASE}/mod/folder/view.php?id=300`,
      sessionCookies: "",
    });

    expect(files).toHaveLength(2);
    expect(files[0]?.name).toBe("lecture1.pdf");
    expect(files[0]?.url).toContain("lecture1.pdf");
    expect(files[1]?.name).toBe("lecture2.pdf");
  });
});

describe("Parsing: HTML entity decoding in names", () => {
  it("decodes hex HTML entities in activity names (e.g. &#x25BA; → ►)", async () => {
    const html = `
      <html><body>
        <li class="section" data-sectionname="&#x25BA;Stichwort &quot;Wissenschaft&quot;">
          <ul>
            <li class="activity resource">
              <a href="${BASE}/mod/resource/view.php?id=1">&#x25BA;Artikel &amp; Notizen</a>
            </li>
          </ul>
        </li>
      </body></html>`;

    mockAgent.get(BASE)
      .intercept({ path: `/course/view.php?id=99`, method: "GET" })
      .reply(200, html);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 99, sessionCookies: "" });

    expect(tree.sections[0]?.sectionName).toBe('►Stichwort "Wissenschaft"');
    expect(tree.sections[0]?.activities[0]?.activityName).toBe("►Artikel & Notizen");
  });

  it("decodes decimal HTML entities in activity names (e.g. &#9658; → ►)", async () => {
    const html = `
      <html><body>
        <li class="section" data-sectionname="&#9658;Lektion 1">
          <ul>
            <li class="activity resource">
              <a href="${BASE}/mod/resource/view.php?id=2">Folien &#9658; Teil 1</a>
            </li>
          </ul>
        </li>
      </body></html>`;

    mockAgent.get(BASE)
      .intercept({ path: `/course/view.php?id=100`, method: "GET" })
      .reply(200, html);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 100, sessionCookies: "" });

    expect(tree.sections[0]?.sectionName).toBe("►Lektion 1");
    expect(tree.sections[0]?.activities[0]?.activityName).toBe("Folien ► Teil 1");
  });

  it("decodes &amp; &lt; &gt; &quot; in names", () => {
    const element = `
      class="activity resource"
    >
      <a href="${BASE}/mod/resource/view.php?id=3">
        Einführung &amp; Grundlagen &lt;2024&gt;
      </a>
    `;
    const result = parseActivityFromElement(element, `${BASE}/course/view.php?id=1`);
    expect(result?.activityName).toBe("Einführung & Grundlagen <2024>");
  });
});

