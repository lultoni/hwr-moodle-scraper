/**
 * Course keyword filter — state-based fuzzy matching.
 *
 * Matches comma-separated keywords against course names stored in State.
 * Case-insensitive substring match. No API call required.
 */

import type { State } from "../sync/state.js";

export function matchCourses(
  keywords: string,
  state: State | null,
): { ids: number[]; unmatched: string[] } {
  const tokens = keywords
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return { ids: [], unmatched: [] };

  const courses = state ? Object.entries(state.courses) : [];
  const idSet = new Set<number>();
  const unmatched: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    let matched = false;
    for (const [id, cs] of courses) {
      if (cs.name.toLowerCase().includes(lower)) {
        idSet.add(Number(id));
        matched = true;
      }
    }
    if (!matched) unmatched.push(token);
  }

  return { ids: Array.from(idSet), unmatched };
}
