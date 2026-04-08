// Tests for label-based subfolder grouping.
// Divider labels (short, heading-like) create subfolders; subsequent
// activities are grouped under them until the next divider.

import { describe, it, expect } from "vitest";
import { isDividerLabel, applyLabelSubfolders } from "../../src/scraper/dispatch.js";
import type { Activity } from "../../src/scraper/courses.js";

// ── isDividerLabel heuristic ──────────────────────────────────────────

describe("isDividerLabel — identifies short heading labels as dividers", () => {
  // ── Should be dividers ────────────────────────────────────────────

  it("VdZ: icon + bold heading (Aktivitäten)", () => {
    const html = `<h5><img src="https://moodle.hwr-berlin.de/pluginfile.php/406721/calendar_icon.png" class="iconlarge"> <b>Aktivitäten</b></h5>`;
    expect(isDividerLabel(html)).toBe(true);
  });

  it("VdZ: icon + heading without bold (Information und Kommunikation)", () => {
    const html = `<h4><img src="https://moodle.hwr-berlin.de/pluginfile.php/406842/megaphone_icon.png" class="iconlarge"> Information und Kommunikation</h4>`;
    expect(isDividerLabel(html)).toBe(true);
  });

  it("VdZ: Lernvideos label", () => {
    const html = `<h5><img src="x.png"> <b>Lernvideos</b></h5>`;
    expect(isDividerLabel(html)).toBe(true);
  });

  it("VdZ: Textmaterialien label", () => {
    const html = `<h5><img src="x.png"> <b>Textmaterialien</b></h5>`;
    expect(isDividerLabel(html)).toBe(true);
  });

  it("VdZ: Prüfungsleistung label", () => {
    const html = `<h5><img src="x.png"> <b>Prüfungsleistung</b></h5>`;
    expect(isDividerLabel(html)).toBe(true);
  });

  it("FRbüro: plain text divider (Formulare & Merkblätter)", () => {
    const html = `Termine, Formulare &amp; Merkblätter zu Klausuren/Prüfungen`;
    expect(isDividerLabel(html)).toBe(true);
  });

  it("plain short text label (one line, no links)", () => {
    const html = `<p>Wichtige Hinweise</p>`;
    expect(isDividerLabel(html)).toBe(true);
  });

  it("short heading without icon", () => {
    const html = `<h3>Materialien</h3>`;
    expect(isDividerLabel(html)).toBe(true);
  });

  // ── Should NOT be dividers ────────────────────────────────────────

  it("VdZ: Einführung content label with learning objectives (multi-paragraph)", () => {
    const html = `<h5><img src="x.png"> <b>Einführung in das digitale Zeitalter</b></h5>
<p><b>In dieser ersten Lerneinheit lernen Sie:</b></p>
<ul>
<li>die wesentlichen begrifflichen Grundlagen</li>
<li>die Eigenschaften des digitalen Zeitalters sowie</li>
<li>die Entwicklung und Trends des digitalen Zeitalters.</li>
</ul>
<p><b>Die Lernziele dieser Einheit sind:</b></p>
<ol>
<li>Was sind die grundlegenden Eigenschaften?</li>
<li>Welche grundlegenden Mechanismen bestimmen über die Wirkungsweise?</li>
<li>Welche zukünftigen Skills benötigen wir?</li>
</ol>`;
    expect(isDividerLabel(html)).toBe(false);
  });

  it("multi-paragraph instructional content", () => {
    const html = `<p>Ihre Lernreise durch die Lehrveranstaltung</p>
<p>Dieser Moodle-Kurs begleitet Sie durch das gesamte Semester.</p>
<ul><li>Präsenz: Vorlesungen vor Ort</li><li>Online: Synchrone Sessions</li><li>Asynchron: Selbststudium</li></ul>`;
    expect(isDividerLabel(html)).toBe(false);
  });

  it("label with external links is not a divider", () => {
    const html = `<p>Hier finden Sie <a href="https://example.com/docs">die Dokumentation</a> zum Kurs.</p>`;
    expect(isDividerLabel(html)).toBe(false);
  });

  it("label with icon image but no external text links is a divider (VdZ real HTML)", () => {
    // Real VdZ HTML: image link is inside <img> tag, not an <a> link
    const html = `<div class="no-overflow"><div class="no-overflow"><h4><img src="https://moodle.hwr-berlin.de/pluginfile.php/4335357/mod_label/intro/406842_megaphone_icon.png" alt=" " width="75" height="75" class="img-responsive atto_image_button_middle"><span style="font-size: 1.75rem;">Information und Kommunikation</span></h4><p></p></div></div>`;
    expect(isDividerLabel(html)).toBe(true);
  });

  it("label with list items is not a divider", () => {
    const html = `<h5>Themen</h5><ul><li>Thema 1</li><li>Thema 2</li><li>Thema 3</li></ul>`;
    expect(isDividerLabel(html)).toBe(false);
  });

  it("long single line is not a divider (>80 chars of pure text)", () => {
    const html = `<p>Dies ist ein sehr langer Beschreibungstext der mehr als achtzig Zeichen hat und deswegen kein Divider Label sein sollte weil er zu lang ist</p>`;
    expect(isDividerLabel(html)).toBe(false);
  });

  it("empty description is not a divider", () => {
    expect(isDividerLabel("")).toBe(false);
    expect(isDividerLabel("   ")).toBe(false);
  });
});

// ── applyLabelSubfolders ──────────────────────────────────────────────

function makeActivity(
  name: string,
  type: string,
  opts?: { description?: string; url?: string; subDir?: string },
): Activity {
  return {
    activityType: type,
    activityName: name,
    url: opts?.url ?? (type === "label" ? "" : `https://moodle.example.com/mod/${type}/view.php?id=1`),
    isAccessible: true,
    description: opts?.description,
    subDir: opts?.subDir,
  };
}

describe("applyLabelSubfolders — groups activities under divider labels", () => {
  it("VdZ Lerneinheit 1 pattern: divider labels create subfolders", () => {
    const activities: Activity[] = [
      // Content label at top — stays at root
      makeActivity("Einführung in das digitale Zeitalter", "label", {
        description: `<h5><img src="x.png"> <b>Einführung</b></h5><p>In dieser Lerneinheit lernen Sie:</p><ul><li>punkt 1</li><li>punkt 2</li></ul>`,
      }),
      // Divider: Lernvideos
      makeActivity("Lernvideos", "label", {
        description: `<h5><img src="x.png"> <b>Lernvideos</b></h5>`,
      }),
      makeActivity("Erklärvideo", "resource", { url: "https://moodle.example.com/mod/resource/view.php?id=1" }),
      // Divider: Textmaterialien
      makeActivity("Textmaterialien", "label", {
        description: `<h5><img src="x.png"> <b>Textmaterialien</b></h5>`,
      }),
      makeActivity("HBR Artikel", "url", { url: "https://example.com/article" }),
      // Pflichtliteratur is a content label — its actual description is just "." (almost empty)
      // It should NOT start a new subfolder; it belongs under Textmaterialien
      makeActivity("Pflichtliteratur zum Selbststudium Lerneinheit 1", "label", {
        description: `<p>&nbsp; &nbsp;.</p>`,
      }),
      // Divider: Aktivitäten
      makeActivity("Aktivitäten", "label", {
        description: `<h5><img src="x.png"> <b>Aktivitäten</b></h5>`,
      }),
      makeActivity("1. Gruppenarbeit", "etherpadlite", { url: "https://moodle.example.com/mod/etherpadlite/view.php?id=1" }),
      makeActivity("Belegaufgabe 1", "assign", { url: "https://moodle.example.com/mod/assign/view.php?id=1" }),
    ];

    const result = applyLabelSubfolders(activities);

    // Content label: no subDir
    expect(result[0]!.subDir).toBeUndefined();
    // Divider label "Lernvideos": gets its own subDir
    expect(result[1]!.subDir).toBe("Lernvideos");
    // Activity under Lernvideos
    expect(result[2]!.subDir).toBe("Lernvideos");
    // Divider label "Textmaterialien"
    expect(result[3]!.subDir).toBe("Textmaterialien");
    // Activities under Textmaterialien
    expect(result[4]!.subDir).toBe("Textmaterialien");
    expect(result[5]!.subDir).toBe("Textmaterialien");
    // Divider label "Aktivitäten"
    expect(result[6]!.subDir).toBe("Aktivitäten");
    // Activities under Aktivitäten
    expect(result[7]!.subDir).toBe("Aktivitäten");
    expect(result[8]!.subDir).toBe("Aktivitäten");
  });

  it("VdZ Allgemeines pattern: first items before any divider stay at root", () => {
    const activities: Activity[] = [
      // Activities before first divider → root
      makeActivity("Austauschforum", "forum", { url: "https://moodle.example.com/mod/forum/view.php?id=1" }),
      makeActivity("Forum Hinweise", "forum", { url: "https://moodle.example.com/mod/forum/view.php?id=2" }),
      // Divider: Information und Kommunikation
      makeActivity("Information und Kommunikation", "label", {
        description: `<h4><img src="icon.png"> Information und Kommunikation</h4>`,
      }),
      makeActivity("Gruppeneinteilung", "grouptool", { url: "https://moodle.example.com/mod/grouptool/view.php?id=1" }),
      // Divider: Video-Konferenzen
      makeActivity("Video-Konferenzen", "label", {
        description: `<h4><img src="icon.png"> Video-Konferenzen</h4>`,
      }),
      makeActivity("BBB-Raum", "bigbluebuttonbn", { url: "https://moodle.example.com/mod/bigbluebuttonbn/view.php?id=1" }),
    ];

    const result = applyLabelSubfolders(activities);

    // Before first divider → no subDir
    expect(result[0]!.subDir).toBeUndefined();
    expect(result[1]!.subDir).toBeUndefined();
    // Divider + children
    expect(result[2]!.subDir).toBe("Information und Kommunikation");
    expect(result[3]!.subDir).toBe("Information und Kommunikation");
    expect(result[4]!.subDir).toBe("Video-Konferenzen");
    expect(result[5]!.subDir).toBe("Video-Konferenzen");
  });

  it("no divider labels → no subDirs assigned", () => {
    const activities: Activity[] = [
      makeActivity("Content Label", "label", {
        description: `<p>This is a long content label with lots of text describing things.</p><ul><li>Item 1</li><li>Item 2</li></ul>`,
      }),
      makeActivity("Lecture Notes", "resource", { url: "https://moodle.example.com/mod/resource/view.php?id=1" }),
      makeActivity("Assignment", "assign", { url: "https://moodle.example.com/mod/assign/view.php?id=1" }),
    ];

    const result = applyLabelSubfolders(activities);

    expect(result[0]!.subDir).toBeUndefined();
    expect(result[1]!.subDir).toBeUndefined();
    expect(result[2]!.subDir).toBeUndefined();
  });

  it("preserves existing subDir from folder expansion", () => {
    const activities: Activity[] = [
      makeActivity("Divider A", "label", {
        description: `<h5>Section A</h5>`,
      }),
      makeActivity("File in section A", "resource", { url: "https://moodle.example.com/mod/resource/view.php?id=1" }),
      makeActivity("Materialien", "label", {
        description: `<h5>Materialien</h5>`,
      }),
      makeActivity("File inside folder", "resource", {
        url: "https://moodle.example.com/mod/resource/view.php?id=2",
        subDir: "Foliensammlung",
      }),
      makeActivity("File without folder", "resource", { url: "https://moodle.example.com/mod/resource/view.php?id=3" }),
    ];

    const result = applyLabelSubfolders(activities);

    // First divider
    expect(result[0]!.subDir).toBe("Divider A");
    expect(result[1]!.subDir).toBe("Divider A");
    // Second divider
    expect(result[2]!.subDir).toBe("Materialien");
    // Activity with existing subDir keeps it (folder subDir takes priority)
    expect(result[3]!.subDir).toBe("Foliensammlung");
    // Activity without existing subDir gets divider subDir
    expect(result[4]!.subDir).toBe("Materialien");
  });

  it("single divider label with subsequent activities does create a subfolder", () => {
    const activities: Activity[] = [
      makeActivity("Only Divider", "label", {
        description: `<h5>Materialien</h5>`,
      }),
      makeActivity("File A", "resource", { url: "https://moodle.example.com/mod/resource/view.php?id=1" }),
      makeActivity("File B", "resource", { url: "https://moodle.example.com/mod/resource/view.php?id=2" }),
    ];

    const result = applyLabelSubfolders(activities);

    // Single divider → grouping activated
    expect(result[0]!.subDir).toBe("Only Divider");
    expect(result[1]!.subDir).toBe("Only Divider");
    expect(result[2]!.subDir).toBe("Only Divider");
  });

  it("FRbüro: plain text divider grouping", () => {
    const activities: Activity[] = [
      makeActivity("Prüfungsausschuss", "url", { url: "https://moodle.example.com/mod/url/view.php?id=1" }),
      // Divider: Formulare
      makeActivity("Formulare & Merkblätter", "label", {
        description: `Termine, Formulare &amp; Merkblätter zu Klausuren/Prüfungen`,
      }),
      makeActivity("Antrag Rücktritt", "resource", { url: "https://moodle.example.com/mod/resource/view.php?id=1" }),
      makeActivity("Formular Bescheinigung", "resource", { url: "https://moodle.example.com/mod/resource/view.php?id=2" }),
      // Divider: another section
      makeActivity("Weitere Infos", "label", {
        description: `<p>Weitere Informationen</p>`,
      }),
      makeActivity("Infoblatt", "resource", { url: "https://moodle.example.com/mod/resource/view.php?id=3" }),
    ];

    const result = applyLabelSubfolders(activities);

    // Before first divider → root
    expect(result[0]!.subDir).toBeUndefined();
    // Divider + children
    expect(result[1]!.subDir).toBe("Formulare & Merkblätter");
    expect(result[2]!.subDir).toBe("Formulare & Merkblätter");
    expect(result[3]!.subDir).toBe("Formulare & Merkblätter");
    expect(result[4]!.subDir).toBe("Weitere Infos");
    expect(result[5]!.subDir).toBe("Weitere Infos");
  });

  it("does not mutate original activities — returns new array with cloned items", () => {
    const original: Activity[] = [
      makeActivity("Divider A", "label", { description: `<h5>Section A</h5>` }),
      makeActivity("Divider B", "label", { description: `<h5>Section B</h5>` }),
      makeActivity("File", "resource", { url: "https://moodle.example.com/mod/resource/view.php?id=1" }),
    ];

    const result = applyLabelSubfolders(original);

    // Original should be unmodified
    expect(original[0]!.subDir).toBeUndefined();
    expect(original[2]!.subDir).toBeUndefined();
    // Result should have subDirs (uses activityName, not heading text)
    expect(result[2]!.subDir).toBe("Divider B");
  });
});
