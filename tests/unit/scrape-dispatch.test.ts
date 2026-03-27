// Covers: STEP-015-fix, REQ-SCRAPE-005, REQ-SCRAPE-006
//
// Tests for scrape command dispatch of different activity types:
// - resource → follow redirect to file, download binary
// - url → save as .url.txt
// - page → fetch HTML, convert to .md
// - assign → skip download (metadata only)
// - forum → skip download (metadata only)
// - quiz, glossary, grouptool, bigbluebuttonbn → skip gracefully

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

  it("assign → skip (no download item produced)", () => {
    const act = makeActivity({ activityType: "assign", url: "https://moodle.example.com/mod/assign/view.php?id=20" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items).toHaveLength(0);
  });

  it("forum → skip (no download item produced)", () => {
    const act = makeActivity({ activityType: "forum", url: "https://moodle.example.com/mod/forum/view.php?id=30" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items).toHaveLength(0);
  });

  it("quiz → skip gracefully", () => {
    const act = makeActivity({ activityType: "quiz", url: "https://moodle.example.com/mod/quiz/view.php?id=40" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items).toHaveLength(0);
  });

  it("glossary → skip gracefully", () => {
    const act = makeActivity({ activityType: "glossary", url: "https://moodle.example.com/mod/glossary/view.php?id=50" });
    const items = buildDownloadPlan([act], "Kurs", "Abschnitt", "/output");
    expect(items).toHaveLength(0);
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
