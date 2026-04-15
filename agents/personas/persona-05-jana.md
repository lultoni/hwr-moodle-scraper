## Role
Jana — 4th semester WI student, intermediate user who treats the output folder as her primary study workspace and has accumulated personal files alongside scraped content.

## Profile
- **Semester**: 4
- **Major**: Wirtschaftsinformatik (WI)
- **OS**: macOS
- **Tech level**: Intermediate — comfortable with Terminal for basic tasks, uses git occasionally, knows what a config file is but does not read source code
- **Moodle courses**: 16 enrolled (full 4th semester load)
- **Usage history**: 6 months — installed mid-semester 3, used regularly since
- **Long-term state**: ~80 personal files accumulated in the output folder: lecture notes in Markdown, annotated PDFs she renamed, a few Word documents with summaries. Several personal notes are inside `_User-Files/` subfolders she created manually after hearing about the convention somewhere. Others are scattered directly inside course or section folders (not in `_User-Files/`). She has been running `msc scrape` regularly and the scraper has never complained about her files.
- **Use pattern**: Runs `msc scrape` before each week of classes (Sunday evening); opens the output folder in Obsidian as a vault; syncs the folder to iCloud for access on her iPhone
- **Motivations**: One place for all study materials — both downloaded and personal notes; Obsidian graph view links her notes to course files; iCloud sync keeps everything available on mobile
- **Frustrations pre-tool**: Had to download course files manually and keep them in a chaotic Downloads folder; no way to see at a glance what was new since last week

## Workflow Trace

1. **Routine scrape — first time noticing "User-added files: 80"**
   - What she tries: runs her weekly scrape as usual.
   - Command: `msc scrape`
   - What she sees: "Done: 12 downloaded, 0 skipped. | User-added files: 80" in the summary. She has never noticed this line before (or the count was lower and she ignored it).
   - Reaction: Confused — she knows she has personal notes in the folder but doesn't understand why the tool is counting them or what "user-added" means in this context. Wonders if the scraper is about to delete her files.

2. **Checking `msc status` to understand the situation**
   - What she tries: run status to learn more.
   - Command: `msc status`
   - What she sees: A summary table with "User-added files: 80". The line is there but there is no explanation of what it means or what she should do about it.
   - Reaction: Slightly relieved the word "delete" does not appear. But still confused about whether this is a warning, an error, or just information.

3. **Running `msc status --issues` to see the full list**
   - What she tries: get more detail about what exactly is "user-added".
   - Command: `msc status --issues`
   - What she sees: A tree of 80 file paths grouped under each course. She can recognise her own notes in the list. The output is about 100 lines long. She also notices a tip line at the bottom: "Tip: Run `msc clean`...".
   - Reaction: Relieved to see her notes are just listed, not deleted. But the output is long and overwhelming. She wonders what `msc clean` will do.

4. **Running `msc clean --dry-run` to preview**
   - What she tries: understand what `msc clean` would do before running it.
   - Command: `msc clean --dry-run`
   - What she sees: A preview tree listing ALL 80 of her personal notes as files "to be deleted". The word "delete" appears prominently.
   - Reaction: Panics. She does not want her notes deleted. Closes the terminal immediately. Does not run the actual clean.

5. **Trying `msc clean --move` as a safer alternative**
   - What she tries: use the move variant so nothing is permanently deleted.
   - Command: `msc clean --move`
   - What she sees: Confirmation prompt listing how many files will be moved to `User Files/` in the output root. She confirms. Files are moved. Summary: "80 files moved to User Files/."
   - Reaction: Relieved the files still exist, but immediately notices that Obsidian's graph view shows broken links — all her notes that referenced course files by relative path are now broken because the files moved. Her carefully built vault is damaged. Frustrated.

6. **Trying to understand the `_User-Files/` convention**
   - What she tries: figure out why the files she put in `_User-Files/` subfolders still appeared in the "user-added" list.
   - Action: reads `msc status --issues` output more carefully; runs `msc --help`; checks the README.
   - What she sees: No mention of `_User-Files/` anywhere in the CLI help text or the visible README section. The convention exists only in the source and internal docs.
   - Reaction: Feels she followed the right convention (she created `_User-Files/` folders herself based on something she vaguely remembered) but now discovers the scraper does not actually recognise them as "safe" zones — they still appear as user-added. Frustrated that there is no documented way to tell the tool "these are mine".

7. **Running `msc scrape` after the clean**
   - What she tries: confirm that after moving all personal files the status is clean.
   - Command: `msc scrape` then `msc status`
   - What she sees: "User-added files: 0". The scraper runs normally and downloads the latest course files. Status is clean.
   - Reaction: Satisfied that the tool is happy, but now she has to manually re-link her Obsidian notes, and she is not sure how to keep her personal notes safe going forward.

## Gap & Friction Log

| # | Step | Issue | Severity | Type |
|---|------|-------|----------|------|
| 1 | Status summary line | "User-added files: 80" gives no context — no explanation of what it means, what the risk is, or what to do | High | UX |
| 2 | `_User-Files/` convention | The convention for protecting personal files is not documented in `msc --help`, README, or any CLI output | High | Documentation / UX |
| 3 | `msc clean --dry-run` | Dry-run output leads with "to be deleted" language, causing panic; no reassurance that the move variant exists | High | UX |
| 4 | `msc clean --move` path breakage | Moving files to `User Files/` breaks Obsidian relative links and any external app that indexed file paths | Medium | UX |
| 5 | `_User-Files/` recognition | Files inside `_User-Files/` subfolders she created manually still show as user-added; the scraper does not treat them as an opt-in protection zone | High | Feature Gap / Bug |
| 6 | Status verbosity | `msc status --issues` produces ~100 lines for 80 files; no pagination or summary grouping (e.g. "50 files in _User-Files/, 30 scattered") | Medium | UX |
| 7 | No "protect this folder" affordance | No CLI command or config to mark a folder as user-owned so it never appears in status output or clean targets | Medium | Feature Gap |
