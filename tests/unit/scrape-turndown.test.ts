// Tests for Turndown HTML→Markdown conversion, especially table handling.

import { describe, it, expect } from "vitest";
import { createTurndown } from "../../src/scraper/turndown.js";

describe("createTurndown — table conversion", () => {
  it("converts a proper table with <thead>/<th> to Markdown (GFM default)", () => {
    const html = `<table>
      <thead><tr><th>Name</th><th>Wert</th></tr></thead>
      <tbody><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></tbody>
    </table>`;
    const td = createTurndown();
    const md = td.turndown(html);
    expect(md).toContain("| Name | Wert |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| A | 1 |");
    expect(md).toContain("| B | 2 |");
  });

  it("converts headingless table (all <td>, no <th>) to Markdown", () => {
    // WissArb I schedule table — only <td> rows, no <thead>/<th>
    const html = `<table class="MsoTableGrid">
      <tbody>
        <tr><td></td><td>Jahrgang</td><td>Abfrage Thema</td><td>Abgabe</td></tr>
        <tr><td>PTB I</td><td>WI24</td><td>20.01.2025</td><td>14.04.2025</td></tr>
      </tbody>
    </table>`;
    const td = createTurndown();
    const md = td.turndown(html);
    // Should produce a Markdown table (not raw HTML)
    expect(md).toContain("|");
    expect(md).toContain("Jahrgang");
    expect(md).toContain("PTB I");
    expect(md).toContain("14.04.2025");
    // Should not contain raw HTML tags
    expect(md).not.toContain("<table");
    expect(md).not.toContain("<td>");
    expect(md).not.toContain("<tr>");
  });

  it("preserves rich cell content in headingless tables (links, bold)", () => {
    const html = `<table>
      <tbody>
        <tr><td>Titel</td><td>Link</td></tr>
        <tr><td><b>Buch</b></td><td><a href="https://example.com">Example</a></td></tr>
      </tbody>
    </table>`;
    const td = createTurndown();
    const md = td.turndown(html);
    expect(md).toContain("**Buch**");
    expect(md).toContain("[Example](https://example.com)");
  });

  it("handles single-row headingless table", () => {
    const html = `<table><tbody><tr><td>Only</td><td>Row</td></tr></tbody></table>`;
    const td = createTurndown();
    const md = td.turndown(html);
    expect(md).toContain("Only");
    expect(md).toContain("Row");
    expect(md).not.toContain("<td>");
  });

  it("leaves non-table content untouched", () => {
    const html = `<p>Hello <b>world</b></p>`;
    const td = createTurndown();
    const md = td.turndown(html);
    expect(md).toBe("Hello **world**");
  });
});
