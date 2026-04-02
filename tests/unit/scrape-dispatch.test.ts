// Covers: STEP-015-fix, REQ-SCRAPE-005, REQ-SCRAPE-006
//
// Tests for scrape command dispatch of different activity types:
// - resource → follow redirect to file, download binary
// - url → save as .url.txt
// - page → fetch HTML, convert to .md
// - assign, forum, quiz, book, lesson, wiki, workshop, glossary → page-md (fetch and convert)
// - vimp, hvp, h5pactivity, scorm, feedback, choice, flashcard, survey,
//   chat, lti, imscp, grouptool, bigbluebuttonbn → info-md (title + URL + description)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildDownloadPlan, type DownloadPlanItem } from "../../src/scraper/dispatch.js";
import type { Activity } from "../../src/scraper/courses.js";

function makeActivity(overrides: Partial<Activity>): Activity {
  return {
    activityType: "resource",
    activityName: "Test File",
    url: "https://moodle.example.com/mod/resource/view.php?id=1",
    isAccessible: true,
    ...overrides,
  };
}

describe("buildDownloadPlan: activity type dispatch", () => {
  it("resource → download action with binary strategy", () => {
    const act = makeActivity({ activityType: "resource", url: "https://moodle.example.com/mod/resource/view.php?id=1" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items).toHaveLength(1);
    expect(items[0]?.strategy).toBe("binary");
    expect(items[0]?.url).toBe(act.url);
  });

  it("url → download action with url-txt strategy", () => {
    const act = makeActivity({ activityType: "url", url: "https://moodle.example.com/mod/url/view.php?id=5" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items).toHaveLength(1);
    expect(items[0]?.strategy).toBe("url-txt");
  });

  it("page → download action with page-md strategy", () => {
    const act = makeActivity({ activityType: "page", url: "https://moodle.example.com/mod/page/view.php?id=10" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items).toHaveLength(1);
    expect(items[0]?.strategy).toBe("page-md");
  });

  // --- Previously-skipped types: now produce info-md or page-md items ---

  it("assign → info-md (title + URL + description saved as .md)", () => {
    const act = makeActivity({ activityType: "assign", url: "https://moodle.example.com/mod/assign/view.php?id=20" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
    expect(items[0]?.destPath).toMatch(/\.md$/);
  });

  it("forum → page-md (page fetched and converted)", () => {
    const act = makeActivity({ activityType: "forum", url: "https://moodle.example.com/mod/forum/view.php?id=30" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("page-md");
    expect(items[0]?.destPath).toMatch(/\.md$/);
  });

  it("quiz → page-md (page fetched and converted)", () => {
    const act = makeActivity({ activityType: "quiz", url: "https://moodle.example.com/mod/quiz/view.php?id=40" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("page-md");
  });

  it("glossary → page-md (page fetched and converted)", () => {
    const act = makeActivity({ activityType: "glossary", url: "https://moodle.example.com/mod/glossary/view.php?id=50" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("page-md");
  });

  it("book → page-md (page fetched and converted)", () => {
    const act = makeActivity({ activityType: "book", url: "https://moodle.example.com/mod/book/view.php?id=80" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("page-md");
  });

  it("lesson → page-md (page fetched and converted)", () => {
    const act = makeActivity({ activityType: "lesson", url: "https://moodle.example.com/mod/lesson/view.php?id=85" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("page-md");
  });

  it("wiki → page-md (page fetched and converted)", () => {
    const act = makeActivity({ activityType: "wiki", url: "https://moodle.example.com/mod/wiki/view.php?id=87" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("page-md");
  });

  it("workshop → page-md (page fetched and converted)", () => {
    const act = makeActivity({ activityType: "workshop", url: "https://moodle.example.com/mod/workshop/view.php?id=88" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("page-md");
  });

  it("vimp (video player) → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "vimp", url: "https://moodle.example.com/mod/vimp/view.php?id=60" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
    expect(items[0]?.destPath).toMatch(/\.md$/);
  });

  it("feedback → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "feedback", url: "https://moodle.example.com/mod/feedback/view.php?id=70" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("choice → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "choice", url: "https://moodle.example.com/mod/choice/view.php?id=90" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("hvp (H5P) → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "hvp", url: "https://moodle.example.com/mod/hvp/view.php?id=100" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("flashcard → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "flashcard", url: "https://moodle.example.com/mod/flashcard/view.php?id=110" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("scorm → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "scorm", url: "https://moodle.example.com/mod/scorm/view.php?id=111" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("h5pactivity → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "h5pactivity", url: "https://moodle.example.com/mod/h5pactivity/view.php?id=112" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("lti (external tool) → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "lti", url: "https://moodle.example.com/mod/lti/view.php?id=113" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("imscp → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "imscp", url: "https://moodle.example.com/mod/imscp/view.php?id=114" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("grouptool → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "grouptool", url: "https://moodle.example.com/mod/grouptool/view.php?id=115" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("bigbluebuttonbn → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "bigbluebuttonbn", url: "https://moodle.example.com/mod/bigbluebuttonbn/view.php?id=116" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("survey → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "survey", url: "https://moodle.example.com/mod/survey/view.php?id=117" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("chat → info-md (URL + description saved)", () => {
    const act = makeActivity({ activityType: "chat", url: "https://moodle.example.com/mod/chat/view.php?id=118" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.strategy).toBe("info-md");
  });

  it("info-md item destPath ends in .md", () => {
    const act = makeActivity({ activityType: "vimp", activityName: "Vorlesung Video", url: "https://moodle.example.com/mod/vimp/view.php?id=60" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items[0]?.destPath).toMatch(/\.md$/);
  });

  it("info-md with description also emits description-md sidecar", () => {
    const act = makeActivity({
      activityType: "vimp",
      activityName: "Vorlesung Video",
      url: "https://moodle.example.com/mod/vimp/view.php?id=60",
      description: "<p>Embedded video lecture</p>",
    });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    const infoItem = items.find(i => i.strategy === "info-md");
    const descItem = items.find(i => i.strategy === "description-md");
    expect(infoItem).toBeDefined();
    expect(descItem).toBeDefined();
  });

  it("page-md type with description also emits description-md sidecar", () => {
    const act = makeActivity({
      activityType: "forum",
      activityName: "Diskussionsforum",
      url: "https://moodle.example.com/mod/forum/view.php?id=30",
      description: "<p>Forum for discussion</p>",
    });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    const pageItem = items.find(i => i.strategy === "page-md");
    const descItem = items.find(i => i.strategy === "description-md");
    expect(pageItem).toBeDefined();
    expect(descItem).toBeDefined();
  });

  it("inaccessible activities are excluded regardless of type", () => {
    const act = makeActivity({ activityType: "resource", isAccessible: false });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items).toHaveLength(0);
  });

  it("resource destPath uses the activity name (not view.php)", () => {
    const act = makeActivity({ activityType: "resource", activityName: "Lecture Notes", url: "https://moodle.example.com/mod/resource/view.php?id=1" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items[0]?.destPath).toContain("Lecture Notes");
  });

  it("page destPath ends in .md", () => {
    const act = makeActivity({ activityType: "page", activityName: "Kursübersicht", url: "https://moodle.example.com/mod/page/view.php?id=10" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items[0]?.destPath).toMatch(/\.md$/);
  });

  it("url destPath ends in .url.txt", () => {
    const act = makeActivity({ activityType: "url", activityName: "Externes Dokument", url: "https://moodle.example.com/mod/url/view.php?id=5" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items[0]?.destPath).toMatch(/\.url\.txt$/);
  });

  it("label with description → label-md strategy, destPath ends in .md", () => {
    const act = makeActivity({ activityType: "label", url: "", description: "<p>Dauer: 120 Minuten</p>" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items).toHaveLength(1);
    expect(items[0]?.strategy).toBe("label-md");
    expect(items[0]?.destPath).toMatch(/\.md$/);
  });

  it("label without description → skip (no download item)", () => {
    const act = makeActivity({ activityType: "label", url: "", description: undefined });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items).toHaveLength(0);
  });

  it("resource with description → binary item plus description-md sidecar", () => {
    const act = makeActivity({
      activityType: "resource",
      activityName: "Aufgaben",
      url: "https://moodle.example.com/mod/resource/view.php?id=99",
      description: "<p>Liebe Studierende, hier die Aufgaben.</p>",
    });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    // Should have binary item + description sidecar
    expect(items).toHaveLength(2);
    const binary = items.find(i => i.strategy === "binary");
    const desc = items.find(i => i.strategy === "description-md");
    expect(binary).toBeDefined();
    expect(desc).toBeDefined();
    expect(desc?.destPath).toMatch(/\.description\.md$/);
  });
});
