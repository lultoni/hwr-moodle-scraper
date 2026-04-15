## Role
GoodNotes annotation power user — carefully manages which PDFs have been imported to avoid losing annotations.

## Profile

- **Semester**: 3rd
- **Major**: Wirtschaftsinformatik (WI)
- **OS**: macOS + iPad (primary annotation device)
- **Tech level**: Intermediate — comfortable with Terminal and file management; reads CLI help text; uses git for assignments
- **Moodle courses**: 13 enrolled
- **Usage history**: 6 months (installed at the start of semester 3)
- **Long-term state**: Approximately 30 PDFs annotated in GoodNotes; annotations live in GoodNotes' internal library (not linked to the iCloud output folder); output folder syncs to iCloud Drive; state file intact with 6 months of history
- **Use pattern**: Runs `msc scrape` weekly on Mac; reviews change report in terminal; manually imports only NEW (never-annotated) PDFs into GoodNotes on iPad; intentionally skips re-importing updated PDFs to preserve existing annotations
- **Motivations**: Study with Apple Pencil annotations (diagrams, highlights, margin notes); keep a clean GoodNotes library without duplicate versions of the same file
- **Frustrations pre-tool**: Manually tracking which PDFs are new vs already in GoodNotes; accidentally importing updated PDFs and creating a blank duplicate alongside the annotated original

## Workflow Trace

1. **Runs `msc scrape` on Mac** — scrape completes. Change report prints: `+ Semester_3/WI3042/Section 3/Fallstudie 2.pdf`, `+ Semester_3/WI3045/Abgabe/Aufgabe 5.pdf`, `~ Semester_3/WI3042/Section 2/Vorlesung 04.pdf`, `~ Semester_3/WI3010/Section 1/Skript Kapitel 3.pdf`.

2. **Reads change report carefully** — 2 new PDFs (`+`), 2 updated PDFs (`~`). He wants to import the 2 new ones into GoodNotes but NOT the 2 updated ones (those are already annotated in GoodNotes). He mentally notes the filenames.

3. **Closes the terminal** — the change report is gone. He switches to his iPad, opens GoodNotes, tries to remember which files were the new ones. Gets the filenames slightly wrong. Opens Files app to browse the iCloud output folder.

4. **Searches the iCloud folder on iPad for "Fallstudie 2.pdf"** — finds it. Imports into GoodNotes. Good.

5. **Accidentally also imports "Vorlesung 04.pdf"** — this was an updated file (`~`), not new. GoodNotes creates a new blank copy. His annotated version is still in GoodNotes library but now he has two entries: "Vorlesung 04" (annotated, old version) and "Vorlesung 04" (blank, new version). He has to manually delete the blank one and find the annotated original. This is exactly the workflow problem he was trying to avoid.

6. **Looks for `msc status --changed` to retrieve the change list after closing terminal** — no such flag. `msc status` shows counts; `msc status --issues` shows missing/orphaned. No "changed" view.

7. **Looks for a `msc log` command** — does not exist. Checks README for "change log" or "sync log" — not found.

8. **Wishes the scraper wrote a `_NewFiles.md` or `_Changes.md` to the output folder** — that file would sync to iCloud and he could read it on his iPad before importing into GoodNotes. He would know exactly which PDFs are safe to import.

9. **Checks if GoodNotes has a way to detect "this PDF in my library has a newer version in Files app"** — GoodNotes has no such feature. The annotation-preservation problem is entirely on the user to manage.

10. **Considers running `msc scrape` with some flag that marks or segregates new vs updated files** — no such flag. All files go into the same folder structure regardless of whether they are new or updated.

## Gap & Friction Log

| # | Step | Issue | Severity | Type |
|---|------|-------|----------|------|
| 1 | Change tracking | Change report is ephemeral — printed to terminal only, not persisted; closed terminal = lost information | High | Feature gap |
| 2 | iPad workflow | No persistent change log in the output folder (e.g. `_Changes.md`) that syncs to iCloud and is readable on iPad before importing to GoodNotes | High | Feature gap |
| 3 | Annotation safety | No way to distinguish "new file" from "updated file" after the scrape run ends; `msc status` has no `--changed` or `--since` flag | High | Feature gap |
| 4 | GoodNotes integration | Importing an updated PDF into GoodNotes creates a blank duplicate alongside the annotated original — no warning or prevention mechanism in the scraper | Medium | UX (out of scope for tool, but documentable) |
| 5 | Change report format | Change report in terminal output lists files in processing order, not grouped by course; hard to scan for specific courses with 13 enrolled | Low | UX |

## Feature Requests & Findings

**TICKET-1**
- **Type**: Feature gap
- **Persona**: Ben (persona-14), Hannah (persona-13), Nele (persona-11)
- **Severity**: High
- **Description**: The change report (`+`/`~` prefixed lines) printed at the end of `msc scrape` is ephemeral — it exists only in the terminal session. Users on an iPad-first workflow (Ben, Nele) need to review the list of new vs updated files on their iPad before deciding what to import into GoodNotes. There is currently no way to retrieve this information after the terminal session ends.
- **Proposed resolution**: Write a `_LastSync.md` file to the root of the output directory after each scrape. Contents: ISO timestamp of the scrape, total counts, and two sections — "New files" (paths prefixed `+`) and "Updated files" (paths prefixed `~`). Overwrite on each run (only last sync shown). Track in `State.generatedFiles`. This file syncs to iCloud automatically, is readable in Files app on iPad, and serves as a persistent source of truth for the change report. See also persona-13-hannah TICKET-1.
- **Affected commands/flows**: `msc scrape`, `runScrape` in `src/commands/scrape.ts`, `State.generatedFiles`

**TICKET-2**
- **Type**: Feature gap
- **Persona**: Ben (persona-14), Hannah (persona-13)
- **Severity**: High
- **Description**: There is no `msc status --changed` or `msc log` command to query what changed in the last scrape after the terminal session ends. The information exists only in the ephemeral terminal output. Users cannot retrieve "new files since last run" programmatically.
- **Proposed resolution**: Persist a `lastSync` object in the state file: `{ timestamp: string, newFiles: string[], updatedFiles: string[] }`. Populate it at the end of each `runScrape`. Add `msc status --changed` flag that reads and prints this object. Output format: same `+`/`~` prefixed relative paths as the change report. This allows users to re-query the last-run changes without re-running the scrape. See also persona-13-hannah TICKET-2.
- **Affected commands/flows**: `msc status`, new `--changed` flag, `State` in `src/sync/state.ts`, `runScrape`

**TICKET-3**
- **Type**: Documentation / UX
- **Persona**: Ben (persona-14), Nele (persona-11)
- **Severity**: Medium
- **Description**: For GoodNotes users, importing an updated PDF (`~` in change report) creates a blank duplicate alongside the annotated original. GoodNotes has no mechanism to detect or prevent this. The scraper gives no warning that a file is an update (as opposed to a new file) at the point of iCloud sync. Users relying only on iCloud Files app cannot distinguish new from updated files.
- **Proposed resolution**: The `_LastSync.md` file (TICKET-1) directly addresses this: it separates `+` new files from `~` updated files in a persistent, iPad-readable document. Additionally, add a note to README under a "GoodNotes / iPad annotation workflow" section: "Files marked `~` (updated) in the change report replace the existing iCloud copy. If you have annotated this PDF in GoodNotes, do NOT re-import the updated version — your GoodNotes annotations are on the old copy inside GoodNotes' internal library and are unaffected."
- **Affected commands/flows**: README, `_LastSync.md` output (TICKET-1)

**TICKET-4**
- **Type**: UX improvement
- **Persona**: Ben (persona-14)
- **Severity**: Low
- **Description**: The change report in `msc scrape` terminal output lists files in processing order, not grouped by course. With 13 courses and potentially 20+ changed files, scanning for a specific course requires reading the entire list. Users who only want to import new files from one specific course find the ungrouped list hard to use.
- **Proposed resolution**: Group change report output by course (first two path segments: `Semester_N/CourseName`). Print each course as a subheading with its `+`/`~` files indented underneath. Add a count per course: `WI3042 Strategisches GPM: 1 new, 2 updated`. This applies both to the terminal change report and the `_LastSync.md` file. See also persona-13-hannah TICKET-4.
- **Affected commands/flows**: `msc scrape` change report, `_LastSync.md` (TICKET-1)
