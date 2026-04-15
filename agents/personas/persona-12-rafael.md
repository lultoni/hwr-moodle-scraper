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
