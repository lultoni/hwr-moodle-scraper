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
