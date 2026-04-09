// Shared Turndown factory with GFM plugin for consistent HTML→Markdown conversion.
// All code that converts HTML to Markdown should use createTurndown() instead of
// new TurndownService() directly, so table/strikethrough support is always enabled.
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export function createTurndown(): TurndownService {
  const td = new TurndownService();
  td.use(gfm);

  // Custom rule: convert headingless tables (all <td>, no <th>) to Markdown.
  // The GFM plugin's table rule only converts tables whose first row uses <th>.
  // Word-exported tables (MsoTableGrid) and many Moodle tables use only <td>.
  td.addRule("headingless-table", {
    filter(node) {
      if (node.nodeName !== "TABLE") return false;
      // Only match tables the GFM plugin would skip (no heading row)
      const rows = node.querySelectorAll("tr");
      if (rows.length === 0) return false;
      const firstRow = rows[0]!;
      // GFM handles it if all cells in first row are <th>
      const cells = firstRow.children;
      for (let i = 0; i < cells.length; i++) {
        if (cells[i]!.nodeName !== "TH") return true; // not all <th> → headingless
      }
      return false; // all <th> → GFM handles it
    },
    replacement(_content, node) {
      const el = node as HTMLElement;
      const rows = Array.from(el.querySelectorAll("tr"));
      if (rows.length === 0) return "";

      const tableRows: string[][] = [];
      for (const row of rows) {
        const cells: string[] = [];
        const children = Array.from(row.children);
        for (const cell of children) {
          // Use Turndown to convert cell content (preserves links, bold, etc.)
          const cellMd = td.turndown(cell.innerHTML).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
          cells.push(cellMd);
        }
        tableRows.push(cells);
      }

      if (tableRows.length === 0) return "";

      // Normalise column count to max
      const colCount = Math.max(...tableRows.map((r) => r.length));
      for (const row of tableRows) {
        while (row.length < colCount) row.push("");
      }

      // First row becomes header; add separator row
      const header = tableRows[0]!;
      const separator = header.map(() => "---");
      const lines = [
        `| ${header.join(" | ")} |`,
        `| ${separator.join(" | ")} |`,
        ...tableRows.slice(1).map((row) => `| ${row.join(" | ")} |`),
      ];
      return "\n\n" + lines.join("\n") + "\n\n";
    },
  });

  return td;
}
