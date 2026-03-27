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

describe("Parsing: Onetopic format — section names from tab nav", () => {
  it("extracts section names from onetopic tab nav when data-sectionname is absent", async () => {
    const html = `
      <html><body>
        <ul class="nav nav-tabs format_onetopic-tabs">
          <li class="nav-item" id="onetabid-100">
            <a href="https://moodle.example.com/course/view.php?id=5&section=1" class="nav-link">Informationen</a>
          </li>
          <li class="nav-item" id="onetabid-101">
            <a href="https://moodle.example.com/course/view.php?id=5&section=2">Stichwort "Wissenschaft"</a>
          </li>
        </ul>
        <ul class="topics section-list">
          <li id="section-1"
              class="section course-section main clearfix"
              data-sectionid="1"
              data-for="section"
              data-id="100"
              data-number="1"
          >
            <ul>
              <li class="activity resource">
                <a href="${BASE}/mod/resource/view.php?id=1">Skript</a>
              </li>
            </ul>
          </li>
          <li id="section-2"
              class="section course-section main clearfix"
              data-sectionid="2"
              data-for="section"
              data-id="101"
              data-number="2"
          >
            <ul>
              <li class="activity resource">
                <a href="${BASE}/mod/resource/view.php?id=2">Folien</a>
              </li>
            </ul>
          </li>
        </ul>
      </body></html>`;

    mockAgent.get(BASE)
      .intercept({ path: `/course/view.php?id=5`, method: "GET" })
      .reply(200, html);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 5, sessionCookies: "" });

    expect(tree.sections[0]?.sectionName).toBe("Informationen");
    expect(tree.sections[1]?.sectionName).toBe('Stichwort "Wissenschaft"');
  });
});

describe("Parsing: Label inline content extraction", () => {
  it("extracts label activity-altcontent HTML as description", async () => {
    const html = `
      <html><body>
        <li class="section" data-sectionname="Klausur">
          <ul>
            <li class="activity label modtype_label" id="module-999">
              <div class="activity-item focus-control activityinline" data-activityname="Klausurinfo" data-region="activity-card">
                <div class="activity-grid noname-grid">
                  <div class="activity-altcontent text-break ">
                    <div class="no-overflow"><div class="no-overflow"><p>Dauer: 120 Minuten</p><p>Hilfsmittel: Taschenrechner</p></div></div>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </li>
      </body></html>`;

    mockAgent.get(BASE)
      .intercept({ path: `/course/view.php?id=10`, method: "GET" })
      .reply(200, html);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 10, sessionCookies: "" });
    const label = tree.sections[0]?.activities[0];

    expect(label?.activityType).toBe("label");
    expect(label?.activityName).toBe("Klausurinfo");
    expect(label?.description).toContain("Dauer: 120 Minuten");
  });

  it("label name falls back to data-activityname when no link present", () => {
    const element = `
      class="activity label modtype_label"
    >
      <div class="activity-item activityinline" data-activityname="Wichtige Hinweise">
        <div class="activity-grid noname-grid">
          <div class="activity-altcontent text-break">
            <div class="no-overflow"><div class="no-overflow"><p>Bitte pünktlich erscheinen.</p></div></div>
          </div>
        </div>
      </div>
    `;
    const result = parseActivityFromElement(element, `${BASE}/course/view.php?id=1`);
    expect(result?.activityName).toBe("Wichtige Hinweise");
    expect(result?.activityType).toBe("label");
    expect(result?.description).toContain("Bitte pünktlich erscheinen");
  });
});

describe("Parsing: Activity description extraction", () => {
  it("extracts activity-description HTML from resource with attached description", () => {
    const element = `
      class="activity resource modtype_resource"
    >
      <div class="activity-item">
        <div class="activity-grid">
          <div class="activityname">
            <a href="${BASE}/mod/resource/view.php?id=50">
              <span class="instancename">Aufgaben Asynchron <span class="accesshide"> Datei</span></span>
            </a>
          </div>
          <div class="activity-altcontent text-break activity-description">
            <div class="no-overflow"><div class="no-overflow"><p>Liebe Studierende, hier die Aufgaben.</p></div></div>
          </div>
        </div>
      </div>
    `;
    const result = parseActivityFromElement(element, `${BASE}/course/view.php?id=1`);
    expect(result?.activityType).toBe("resource");
    expect(result?.activityName).toBe("Aufgaben Asynchron");
    expect(result?.description).toContain("Liebe Studierende");
  });

  it("extracts deeply nested altcontent description (multi-paragraph assign description)", () => {
    // Mirrors real assign HTML: <div class="activity-altcontent"><div class="no-overflow"><div class="no-overflow"><p>...</p><p>...</p></div></div>
    const element = `
      class="activity assign modtype_assign"
      id="module-1847126"
      data-for="cmitem"
      data-id="1847126"
    >
      <div class="activity-item focus-control" data-activityname="Einzelaufgabe" data-region="activity-card">
        <div class="activity-grid">
          <div class="activityname">
            <a href="${BASE}/mod/assign/view.php?id=1847126" class="aalink stretched-link">
              <span class="instancename">Einzelaufgabe <span class="accesshide"> Aufgabe</span></span>
            </a>
          </div>
          <div class="activity-altcontent text-break activity-description">
            <div class="no-overflow"><div class="no-overflow"><p dir="ltr">Überlegen Sie sich jeweils einzeln was mit den 6 unterschiedlichen Adjektiven gemeint ist.</p><p dir="ltr">Schreiben Sie Ihre Einschätzungen in 6 Stichpunkten.</p></div></div>
          </div>
        </div>
      </div>
    `;
    const result = parseActivityFromElement(element, `${BASE}/course/view.php?id=1`);
    expect(result?.activityType).toBe("assign");
    expect(result?.activityName).toBe("Einzelaufgabe");
    // Must capture BOTH paragraphs, not just partial content
    expect(result?.description).toContain("Überlegen Sie");
    expect(result?.description).toContain("Schreiben Sie");
  });
});

describe("Parsing: modtype class-based activity type detection", () => {
  it("detects bigbluebuttonbn from modtype class even if URL doesn't match", () => {
    // If the URL is indirect (e.g. external launch), URL-based detection falls back to 'resource'
    // but modtype_bigbluebuttonbn class should win
    const element = `
      class="activity bigbluebuttonbn modtype_bigbluebuttonbn"
      id="module-9999"
    >
      <div class="activity-item" data-activityname="Need help?">
        <div class="activityname">
          <a href="${BASE}/mod/bigbluebuttonbn/view.php?id=9999" class="aalink">
            <span class="instancename">Need help? <span class="accesshide"> Virtueller Unterrichtsraum</span></span>
          </a>
        </div>
      </div>
    `;
    const result = parseActivityFromElement(element, `${BASE}/course/view.php?id=1`);
    expect(result?.activityType).toBe("bigbluebuttonbn");
    expect(result?.activityName).toBe("Need help?");
  });

  it("uses modtype class over URL for assign detection", () => {
    const element = `
      class="activity assign modtype_assign"
    >
      <a href="${BASE}/mod/assign/view.php?id=600">Task</a>
    `;
    const result = parseActivityFromElement(element, `${BASE}/course/view.php?id=1`);
    expect(result?.activityType).toBe("assign");
  });
});

describe("Parsing: format-grid course — section cards", () => {
  it("fetches each grid section card page to collect activities", async () => {
    const pool = mockAgent.get(BASE);

    // Main course page with grid cards
    pool
      .intercept({ path: `/course/view.php?id=77`, method: "GET" })
      .reply(200, `
        <html>
          <body class="format-grid">
            <ul class="grid">
              <li id="section-0" class="section course-section main clearfix" data-sectionname="Allgemeines" data-number="0">
                <ul class="section" data-for="cmlist">
                  <li class="activity resource modtype_resource">
                    <a href="${BASE}/mod/resource/view.php?id=1">General Info</a>
                  </li>
                </ul>
              </li>
            </ul>
            <div class="thegrid">
              <div id="section-1" class="grid-section card" title="Lerneinheit 1">
                <a class="grid-section-inner" href="${BASE}/course/section.php?id=1001">Lerneinheit 1</a>
              </div>
              <div id="section-2" class="grid-section card" title="Lerneinheit 2">
                <a class="grid-section-inner" href="${BASE}/course/section.php?id=1002">Lerneinheit 2</a>
              </div>
            </div>
          </body>
        </html>
      `);

    // Section page 1
    pool
      .intercept({ path: `/course/section.php?id=1001`, method: "GET" })
      .reply(200, `
        <html><body>
          <li class="section course-section main clearfix" data-sectionname="Lerneinheit 1">
            <ul class="section" data-for="cmlist">
              <li class="activity resource modtype_resource">
                <a href="${BASE}/mod/resource/view.php?id=10">Skript 1</a>
              </li>
            </ul>
          </li>
        </body></html>
      `);

    // Section page 2
    pool
      .intercept({ path: `/course/section.php?id=1002`, method: "GET" })
      .reply(200, `
        <html><body>
          <li class="section course-section main clearfix" data-sectionname="Lerneinheit 2">
            <ul class="section" data-for="cmlist">
              <li class="activity resource modtype_resource">
                <a href="${BASE}/mod/resource/view.php?id=20">Skript 2</a>
              </li>
            </ul>
          </li>
        </body></html>
      `);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 77, sessionCookies: "" });

    // Should have: section-0 (general) + 2 grid sections
    expect(tree.sections.length).toBeGreaterThanOrEqual(2);
    const names = tree.sections.map((s) => s.sectionName);
    expect(names).toContain("Lerneinheit 1");
    expect(names).toContain("Lerneinheit 2");
    const allActivities = tree.sections.flatMap((s) => s.activities.map((a) => a.activityName));
    expect(allActivities).toContain("Skript 1");
    expect(allActivities).toContain("Skript 2");
  });
});

describe("Parsing: format-onetopic — multi-tab fetching", () => {
  it("fetches each onetopic tab page to collect all sections", async () => {
    const pool = mockAgent.get(BASE);

    // Main course page shows only section 1 (active), with tab nav listing all tabs
    pool
      .intercept({ path: `/course/view.php?id=88`, method: "GET" })
      .reply(200, `
        <html><body class="format-onetopic">
          <ul class="nav nav-tabs format_onetopic-tabs">
            <li class="nav-item" id="onetabid-101">
              <a class="nav-link active" href="${BASE}/course/view.php?id=88&section=1">Informationen</a>
            </li>
            <li class="nav-item" id="onetabid-102">
              <a class="nav-link" href="${BASE}/course/view.php?id=88&section=2">Unterlagen</a>
            </li>
          </ul>
          <ul class="onetopic">
            <li id="section-1" class="section course-section main clearfix" data-sectionid="1" data-number="1">
              <ul class="section" data-for="cmlist">
                <li class="activity resource modtype_resource">
                  <a href="${BASE}/mod/resource/view.php?id=1">Skript A</a>
                </li>
              </ul>
            </li>
          </ul>
        </body></html>
      `);

    // Section 2 tab page
    pool
      .intercept({ path: `/course/view.php?id=88&section=2`, method: "GET" })
      .reply(200, `
        <html><body class="format-onetopic">
          <ul class="onetopic">
            <li id="section-2" class="section course-section main clearfix" data-sectionid="2" data-number="2">
              <ul class="section" data-for="cmlist">
                <li class="activity resource modtype_resource">
                  <a href="${BASE}/mod/resource/view.php?id=2">Skript B</a>
                </li>
              </ul>
            </li>
          </ul>
        </body></html>
      `);

    const tree = await fetchContentTree({ baseUrl: BASE, courseId: 88, sessionCookies: "" });

    const names = tree.sections.map((s) => s.sectionName);
    expect(names).toContain("Informationen");
    expect(names).toContain("Unterlagen");
    const allActivities = tree.sections.flatMap((s) => s.activities.map((a) => a.activityName));
    expect(allActivities).toContain("Skript A");
    expect(allActivities).toContain("Skript B");
  });
});

describe("Parsing: folder fp-filename span (Moodle 4.x real structure)", () => {
  it("parses folder files where fp-filename span wraps the link (Moodle 4.x)", async () => {
    const { fetchFolderFiles } = await import("../../src/scraper/courses.js");

    const pool = mockAgent.get(BASE);
    pool
      .intercept({ path: `/mod/folder/view.php?id=400`, method: "GET" })
      .reply(200, `
        <html><body>
          <div class="foldertree">
            <div id="folder_tree0" class="filemanager">
              <ul>
                <li>
                  <div class="fp-filename-icon">
                    <span class="fp-filename">
                      <a href="${BASE}/pluginfile.php/4345936/mod_folder/content/0/Blatt%201.pdf?forcedownload=1">Blatt 1.pdf</a>
                    </span>
                  </div>
                </li>
                <li>
                  <div class="fp-filename-icon">
                    <span class="fp-filename">
                      <a href="${BASE}/pluginfile.php/4345936/mod_folder/content/0/Formelsammlung.pdf?forcedownload=1">Formelsammlung.pdf</a>
                    </span>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </body></html>
      `);

    const files = await fetchFolderFiles({
      baseUrl: BASE,
      folderUrl: `${BASE}/mod/folder/view.php?id=400`,
      sessionCookies: "",
    });

    expect(files).toHaveLength(2);
    expect(files[0]?.name).toBe("Blatt 1.pdf");
    expect(files[1]?.name).toBe("Formelsammlung.pdf");
  });
});


