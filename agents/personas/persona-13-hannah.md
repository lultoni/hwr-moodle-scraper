## Role
Apple Notes power user — copies course content into Apple Notes for iCloud search; frustrated by raw Markdown output.

## Profile

- **Semester**: 4th
- **Major**: Wirtschaftsinformatik (WI)
- **OS**: macOS
- **Tech level**: Intermediate — comfortable with Terminal, reads `--help` output, understands the concept of file formats
- **Moodle courses**: 16 enrolled
- **Usage history**: 5 months (installed mid-semester 3)
- **Long-term state**: Output folder exists with a full sync; she manually copies `.md` file contents into Apple Notes after each scrape, organizing by course and topic
- **Use pattern**: Runs `msc scrape` weekly; reviews the change report in the terminal to identify which `.md` files are new or updated; manually copies changed ones into Apple Notes
- **Motivations**: All course content searchable in Apple Notes with iCloud sync; notes available on iPhone and iPad; unified study environment in one app
- **Frustrations pre-tool**: Moodle content was scattered; Apple Notes search didn't cover course materials; had to copy-paste individual pages manually

## Workflow Trace

1. **Opens a `.description.md` file in Apple Notes** — copies the text and pastes it into a new note. Apple Notes shows the raw Markdown: `**Lernziele:**`, `## Aufgabe 1`, `- [ ] Task item`. No rendering. She has to mentally filter out the syntax while reading. Annoying but tolerable.

2. **Tries to "import" a `.md` file into Apple Notes** — there is no import function for `.md` in Apple Notes. She has to copy-paste every time.

3. **Looks for `--format html` or `--format txt` in `msc scrape --help`** — no such flag. Checks README for "plain text" or "HTML output" — not found.

4. **Runs `msc scrape`** — the Done summary prints a change report: `+ Semester_3/WI3042/Section 2/Aufgabe 3.md` and `~ Semester_3/WI3045/Abgabe/Assignment.md`. She wants to know what changed. She reads the terminal output carefully.

5. **Terminal closes** — the change report is gone. She did not copy it. She cannot remember which files changed. She has to re-run `msc status` and compare mentally.

6. **Runs `msc status`** — shows counts and orphans but no "files changed in last run" view. She tries `msc status --issues` — shows missing/orphaned files. No `--changed` flag.

7. **Discovers `_Beschreibungen.md`** — opens one. It consolidates several short descriptions for a section into one file. She finds this genuinely useful — one note to import instead of five tiny ones.

8. **Wishes the `.md` files used plain text headings** — `## Section` renders fine in a Markdown viewer but in Apple Notes shows as `## Section`. She would prefer `Section\n------` (setext-style) or just plain unformatted text with newlines.

9. **Wants a `msc diff` or `msc status --changed` command** to get a persistent list of what changed in the last run — something she can review later without keeping the terminal open.

## Gap & Friction Log

| # | Step | Issue | Severity | Type |
|---|------|-------|----------|------|
| 1 | Note import | Apple Notes does not render Markdown — raw syntax is visible; no `--format txt/html` output option | Medium | Feature gap |
| 2 | Note import | No native `.md` import in Apple Notes (not a scraper bug, but a workflow blocker with no workaround in-tool) | Low | Documentation |
| 3 | Change tracking | Change report printed in scrape output is ephemeral — not saved anywhere for later review | High | Feature gap |
| 4 | Change tracking | No `msc status --changed` or `msc log` command to review what changed in the last scrape run | High | Feature gap |
| 5 | Markdown style | `.md` files use ATX-style headers (`##`) and fenced code blocks — these appear as noise in Apple Notes; no option to change output style | Low | Feature gap |

## Feature Requests & Findings

**TICKET-1**
- **Type**: Feature gap
- **Persona**: Hannah (persona-13)
- **Severity**: High
- **Description**: The change report (`+`/`~` prefixed lines) printed at the end of `msc scrape` is ephemeral — it exists only in terminal output for the duration of the session. Users who close the terminal, switch windows, or run scrape in the background lose the information. There is no way to retrieve "what changed in the last run" after the fact.
- **Proposed resolution**: Write a `_LastSync.md` (or `_Changes.md`) file to the output root directory after each scrape. The file lists the scrape timestamp, counts, and full relative paths of new (`+`) and updated (`~`) files. Overwrite on each run (only the last sync is shown). Track in `State.generatedFiles` so `msc status` and `msc reset` recognize it as scraper-owned. This file is human-readable on any device (iPad, Mac, iPhone via Files app).
- **Affected commands/flows**: `msc scrape`, `runScrape` in `src/commands/scrape.ts`, `State.generatedFiles`

**TICKET-2**
- **Type**: Feature gap
- **Persona**: Hannah (persona-13), Ben (persona-14)
- **Severity**: High
- **Description**: There is no `msc status --changed` or `msc log` command to query what changed in the last run after the fact. `msc status` shows counts and orphans; `msc status --issues` shows missing/orphaned files. Neither shows "files changed in the most recent scrape". Users who want to review changes after closing the terminal have no option.
- **Proposed resolution**: Persist a `lastSync` record in the state file: `{ timestamp: string, newFiles: string[], updatedFiles: string[] }`. Add `msc status --changed` (or `msc log`) to print this record. The `_LastSync.md` from TICKET-1 serves the same purpose for GUI/iPad users; `--changed` serves CLI users. Both read from the same persisted data.
- **Affected commands/flows**: `msc status`, new flag `--changed`, `State` in `src/sync/state.ts`

**TICKET-3**
- **Type**: Documentation
- **Persona**: Hannah (persona-13)
- **Severity**: Low
- **Description**: Apple Notes does not render Markdown natively. Users who copy `.md` content into Apple Notes see raw syntax (`**bold**`, `## header`, `- [ ] task`). There is no in-tool option to produce plain text or HTML output. This is a known limitation of Apple Notes, not a scraper bug, but it is undocumented.
- **Proposed resolution**: Add a "Using with Apple Notes" tip to README: recommend copy-pasting into Notes and note that Markdown will not render. Mention that Obsidian, Bear, or Notion are alternatives that render Markdown natively. Long-term: consider a `--format txt` config key that runs output through a Markdown-to-plaintext strip pass before writing (strip `**`, `##`, backticks, etc.) — low priority given implementation cost.
- **Affected commands/flows**: README, `msc config` (long-term)

**TICKET-4**
- **Type**: UX improvement
- **Persona**: Hannah (persona-13)
- **Severity**: Medium
- **Description**: The change report in scrape output uses relative paths prefixed with `+` (new) and `~` (updated). For users with 16 courses and 1,000+ files, the list can be long. There is no filtering by course or by type (new-only vs updated-only). All changes are printed in the order they were processed.
- **Proposed resolution**: Add optional grouping to the change report: group by course folder (first two path segments). Add a `--report-new-only` flag that suppresses `~` updated entries (useful for users who only want to import truly new files into Apple Notes). Consider adding a count summary per course: "WI3042: 2 new, 1 updated".
- **Affected commands/flows**: `msc scrape` change report in `runScrape`
