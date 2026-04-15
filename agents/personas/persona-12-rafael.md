## Role
Paper-first minimalist — wants PDFs in Finder, nothing else; confused and frustrated by Markdown output.

## Profile

- **Semester**: 2nd
- **Major**: Wirtschaftsinformatik (WI)
- **OS**: macOS
- **Tech level**: Beginner — opens Terminal only when a friend walks him through it; prefers Finder and double-clicking
- **Moodle courses**: 12 enrolled
- **Usage history**: 2 weeks (recommended by a classmate)
- **Long-term state**: First real sync completed; output folder contains approximately 400 files across 12 courses
- **Use pattern**: Runs `msc scrape` once a week to get new PDFs; never uses Terminal for anything else; prints PDFs or opens them in Preview for reading
- **Motivations**: Get all lecture PDFs in one place so he can print them or open them in Preview; stop clicking through Moodle's interface manually
- **Frustrations pre-tool**: Downloading dozens of PDFs by hand every week; Moodle's mobile site is unusable for bulk download

## Workflow Trace

1. **Opens the output folder in Finder** — sees a mix of `.pdf`, `.md`, `.url.txt`, and `.description.md` files. He only wants the PDFs. The other files feel like noise. He does not know what `.md` means.

2. **Tries to delete all `.md` files manually** — selects them in Finder, moves to Trash. Runs `msc scrape` the next day. All the `.md` files are back. He is annoyed.

3. **Asks a friend "what are these .md files?"** — friend explains Markdown. Rafael: "So they're just text files? Why does the program make them?" Friend: "They have the course descriptions in them." Rafael: "I don't need that, I just want the PDFs."

4. **Runs `msc status`** — terminal output shows file counts, orphaned entries, sidecar counts. He reads it once, does not understand "sidecar" or "orphan", closes the terminal. He will not run `msc status` again.

5. **Runs `msc scrape` weekly** — watches the progress bar, feels good when it finishes. Opens Finder, grabs the PDFs he needs. The `.md` files are an ever-present annoyance.

6. **Searches README for "--pdf-only"** — not found. Searches for "skip descriptions" — not found. Gives up.

7. **Notices `_Abschnittsbeschreibung.md` files in some course folders** — the filename with a leading underscore and German compound word looks intimidating and technical. He does not know if he should delete these or if they are important.

8. **Accidentally runs `msc clean`** — he saw it in the `--help` output and thought it would "clean up the clutter" (i.e. the `.md` files). `msc clean` targets user-added files; it prompts for confirmation and lists his manually-added shortcut aliases and a custom PDF he had placed in the output folder. He confirms without reading carefully. The files are deleted. He is upset.

9. **Looks for an undo** — there is no undo. The files are gone.

## Gap & Friction Log

| # | Step | Issue | Severity | Type |
|---|------|-------|----------|------|
| 1 | Browse | Finder shows `.md`, `.url.txt`, `.description.md` files alongside PDFs; no way to suppress them | Medium | Feature gap |
| 2 | Maintenance | Manually deleted `.md` files are recreated on the next scrape run; the user cannot opt out of non-PDF output | Medium | Feature gap |
| 3 | `msc status` | Output uses jargon ("sidecar", "orphan", "state") that is opaque to beginner users | Medium | UX / Documentation |
| 4 | File naming | `_Abschnittsbeschreibung.md` and `.description.md` use technical/German naming conventions opaque to non-developer users | Low | Documentation / UX |
| 5 | `msc clean` | Help text does not clearly communicate that `msc clean` targets USER-added files, not scraper-generated files; beginners may misuse it expecting it to remove `.md` clutter | High | Documentation / UX |
| 6 | Feature gap | No `--no-descriptions` or `--pdf-only` flag to limit output to binary files only | Medium | Feature gap |

## Feature Requests & Findings

**TICKET-1**
- **Type**: Feature gap
- **Persona**: Rafael (persona-12)
- **Severity**: Medium
- **Description**: No flag or config option to suppress `.md`, `.url.txt`, and `.description.md` output. Users who only want binary files (PDFs, images) must manually delete generated text files, which are recreated on the next scrape. This is a recurring frustration for non-developer users.
- **Proposed resolution**: Add a `--no-descriptions` flag (and a persistent config key `writeDescriptions: false`) to `msc scrape`. When set: skip all `description-md` sidecar generation, skip `.url.txt` files, skip `_Abschnittsbeschreibung.md` and `_Beschreibungen.md`. Binary files and `page-md` content still download normally. Document as "PDF-focused mode" in README. Note: already proposed under TICKET-1 in persona-11-nele; this is a supporting reference.
- **Affected commands/flows**: `msc scrape`, `buildDownloadPlan`, `msc config`

**TICKET-2**
- **Type**: Documentation / UX
- **Persona**: Rafael (persona-12)
- **Severity**: High
- **Description**: `msc clean --help` output does not make clear that the command targets USER-added files (files the scraper did not create), not scraper-generated files (`.md`, `.url.txt`). A beginner expecting to "clean up the clutter" will misuse it and potentially delete their own files.
- **Proposed resolution**: Rewrite the `msc clean` help text to explicitly state: "Removes files YOU added to the output folder that the scraper does not recognize. It does NOT remove .md or .url.txt files created by the scraper — use `--no-descriptions` for that." Add an example in `--help` showing a typical use case. Consider adding a `--what-this-does` flag that prints a plain-English explanation.
- **Affected commands/flows**: `msc clean`, help text in `src/commands/clean.ts`

**TICKET-3**
- **Type**: Documentation / UX
- **Persona**: Rafael (persona-12)
- **Severity**: Medium
- **Description**: `msc status` output uses technical jargon ("sidecar", "orphan", "state entries", "sync plan") that is inaccessible to beginner users. After reading the output once, beginners like Rafael dismiss it and never use it again, missing valuable information about their scrape state.
- **Proposed resolution**: Add a `--plain` flag to `msc status` that outputs a human-readable summary using plain language: "You have 423 downloaded files. 5 files from Moodle no longer exist — run `msc reset` to remove them. 2 files you added manually." Avoid all technical jargon in `--plain` mode.
- **Affected commands/flows**: `msc status`, `msc status --issues`

**TICKET-4**
- **Type**: Documentation
- **Persona**: Rafael (persona-12)
- **Severity**: Low
- **Description**: The internal naming conventions for scraper-generated files (`_Abschnittsbeschreibung.md`, `.description.md`, `_Beschreibungen.md`, `_Ordnerbeschreibung.md`) are unexplained anywhere accessible to a non-developer user. There is no in-app or in-folder explanation.
- **Proposed resolution**: Add a "What are all these files?" section to README with a simple table: filename pattern → what it contains → safe to delete? (answer: they will be recreated on next scrape). This sets beginner expectations correctly.
- **Affected commands/flows**: README, first-run wizard output
