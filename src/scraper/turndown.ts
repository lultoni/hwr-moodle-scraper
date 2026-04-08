// Shared Turndown factory with GFM plugin for consistent HTML→Markdown conversion.
// All code that converts HTML to Markdown should use createTurndown() instead of
// new TurndownService() directly, so table/strikethrough support is always enabled.
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export function createTurndown(): TurndownService {
  const td = new TurndownService();
  td.use(gfm);
  return td;
}
