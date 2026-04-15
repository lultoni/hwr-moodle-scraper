## Role
Sophie — 6th semester WI student writing her bachelor thesis, beginner user who has been running `msc scrape` for two years without understanding most of the output.

## Profile
- **Semester**: 6
- **Major**: Wirtschaftsinformatik (WI)
- **OS**: macOS
- **Tech level**: Beginner — can open a Terminal, runs commands she was shown, does not read help text, does not understand technical terminology like "orphan", "state file", or "sync plan"
- **Moodle courses**: 8 enrolled (mostly seminars and bachelor thesis supervision)
- **Usage history**: 2 years — `msc` was installed on her laptop at the start of semester 1 by her developer boyfriend; she has been running `msc scrape` ever since based on his instruction: "just type this and it downloads everything"
- **Long-term state**: 5 completed semesters of orphaned files (~40 orphaned state entries from courses that are now closed in Moodle); output folder is 4.2 GB; she has never run `msc status --issues` and does not know what "Orphaned" means; she only knows the `msc scrape` command
- **Use pattern**: Runs `msc scrape` every few weeks when she remembers or before an exam; just to make sure she has all her files; has never looked at the output carefully
- **Motivations**: Peace of mind — knowing all course materials are on her laptop without having to go to Moodle; her output folder is organised enough that she can find things for her thesis
- **Frustrations pre-tool**: Had to manually download files from Moodle before every exam period; always feared she was missing something

## Workflow Trace

1. **Routine scrape — notices "Orphaned: 40" for the first time**
   - What she tries: routine sync, no special reason.
   - Command: `msc scrape`
   - What she sees: "Done: 3 downloaded, 0 skipped. | Orphaned: 40" — she has seen a similar line before but always ignored it; today, with her thesis deadline approaching, she actually reads it and feels anxious.
   - Reaction: Does not know what "Orphaned" means. Worries something is wrong with her files. Considers texting her boyfriend but it is late at night.

2. **Running `msc status` for the first time**
   - What she tries: run `msc status` because it sounds like it might explain what is wrong.
   - Command: `msc status`
   - What she sees: A summary table with counts: "Downloaded: 1 200", "Orphaned: 40", "User-added: 0". The word "Orphaned" appears again but there is no explanation of what it means or whether it is a problem.
   - Reaction: Confused. "Orphaned" sounds scary — like files that have been abandoned or lost. Does not know if her 1 200 downloaded files are safe or if 40 of them are somehow corrupted.

3. **Googling for help**
   - What she tries: google "moodle-scraper orphaned files" and "msc orphaned" to understand the term.
   - What she sees: No public documentation, no Stack Overflow answers, no GitHub issues. The tool is a personal project with no public presence.
   - Reaction: Dead end. Returns to the Terminal, more anxious than before.

4. **Running `msc status --issues` out of curiosity**
   - What she tries: add `--issues` because it sounds like it shows what is wrong.
   - Command: `msc status --issues`
   - What she sees: A 100-line tree of file paths organised under course folders. All the entries say "orphaned". The paths look like real course material from her first two semesters. The output scrolls past the terminal buffer.
   - Reaction: Overwhelmed. Closes the terminal. The word "orphaned" repeated 40 times in a long list looks like a disaster. She does not understand that these are old, harmless state entries from closed courses — she thinks her files might be corrupted or deleted.

5. **Accidentally running `msc reset` to "start fresh"**
   - What she tries: run `msc reset` because "reset" sounds like it will fix whatever is wrong.
   - Command: `msc reset`
   - What she sees: A confirmation prompt: "This will delete all downloaded files and reset state. Proceed? [y/N]". She reads "delete all downloaded files" but interprets "downloaded files" as the Moodle content she can re-download, not as her 4.2 GB of 5 semesters of course material. She types `y`.
   - What happens: All 4.2 GB of course files are deleted from disk. State is cleared.
   - Reaction: Immediate panic when she sees the output folder is now empty. Realises what happened. Bachelor thesis deadline is tomorrow and she needs lecture slides from previous semesters that are in the folder. Frantically calls her boyfriend.

6. **Attempting recovery**
   - What she tries: re-download everything by running `msc scrape --force`.
   - Command: `msc scrape --force`
   - What she sees: The scraper starts downloading. Progress bar shows 1 200+ items. It is going to take a long time.
   - What happens: The scrape takes approximately 2 hours. Courses from semesters 1–5 that are now closed in Moodle return no files (they are no longer accessible). She recovers only the 8 current-semester courses. The 5 semesters of closed-course material is gone permanently.
   - Reaction: Devastated. Contacts the university to ask if she can still access old Moodle courses. Some materials are partially recovered from email attachments. The thesis deadline situation is very stressful.

## Gap & Friction Log

| # | Step | Issue | Severity | Type |
|---|------|-------|----------|------|
| 1 | "Orphaned" terminology | The word "orphaned" is unexplained jargon; beginner users interpret it as data loss or file corruption | Critical | UX / Terminology |
| 2 | `msc status` no explanation | `msc status` shows counts with no contextual explanation of what each term means or whether action is required | High | UX |
| 3 | No contextual help | There is no `msc help <topic>` or inline "what does this mean?" explanation for terms like "orphaned", "user-added", "state" | High | Feature Gap |
| 4 | `msc status --issues` verbosity | At 40+ orphans the output is ~100 lines; no summary-first approach; overwhelms non-technical users | High | UX |
| 5 | `msc reset` confirmation prompt | The confirmation prompt says "delete all downloaded files" but does not communicate the true scope: permanent deletion of everything including files that cannot be re-downloaded from closed courses | Critical | UX / Safety |
| 6 | `msc reset` default action | `msc reset` with no flags deletes everything including files from closed/inaccessible Moodle courses; no "safe reset" mode that only clears state without deleting disk files | Critical | Feature Gap / Safety |
| 7 | No warning about irreversibility | No warning that files from closed Moodle courses cannot be re-downloaded after a reset | Critical | UX / Safety |
| 8 | Discovery gap | There is no guidance path from "I see Orphaned: 40" to "here is what it means and here is what to do"; the user is left to figure it out alone | High | UX |

## Feature Requests & Findings

**TICKET-1**
- Type: UX Improvement / Safety
- Persona: Sophie
- Severity: Critical
- Description: The word "orphaned" is unexplained technical jargon. Beginner users see it and interpret it as data loss, file corruption, or an error condition requiring urgent action. The term should either be replaced with plain language or always accompanied by an inline explanation.
- Proposed resolution: Replace "Orphaned: 40" in the Done summary and status output with: "Old entries: 40 (course materials from closed courses — your files are safe, no action needed)." Add a hover-style footnote pattern: "Orphaned [?] = Moodle resources that no longer exist; files on disk are unaffected." Adjust wording in `msc status` table accordingly.
- Affected commands/flows: `msc scrape` Done summary, `msc status`, `msc status --issues`

**TICKET-2**
- Type: Safety / UX
- Persona: Sophie
- Severity: Critical
- Description: The `msc reset` confirmation prompt ("This will delete all downloaded files and reset state. Proceed? [y/N]") does not communicate that: (a) the deletion is permanent and immediate, (b) files from closed Moodle courses cannot be re-downloaded, (c) the scope is 4+ GB of accumulated course material. Non-technical users read "downloaded files" as "files I downloaded from the internet" and assume they can be re-downloaded at any time.
- Proposed resolution: (a) Rewrite the confirmation prompt to be explicit: "WARNING: This will permanently delete [N GB] of files across [N courses]. Files from CLOSED Moodle courses CANNOT be recovered after deletion. Type 'DELETE' (all caps) to confirm, or press Enter to cancel." (b) Add a pre-flight warning if any enrolled courses appear to be closed/inaccessible: "Note: [N] courses in your state may no longer be accessible on Moodle. Their files cannot be re-downloaded." (c) Change the default confirmation character from `y` to requiring the word "DELETE" to prevent accidental confirmations.
- Affected commands/flows: `msc reset`, `msc reset --full`

**TICKET-3**
- Type: Feature Gap / Safety
- Persona: Sophie
- Severity: Critical
- Description: `msc reset` deletes both the state file and all files on disk. There is no "state-only reset" mode that clears the state file (removing orphaned entries, fixing corruption) without touching any files on disk. This is the operation that most users who run `msc reset` to "fix something" actually want.
- Proposed resolution: Change the default behaviour of `msc reset` to clear state only (no file deletion). Add a `--delete-files` flag (or keep `--full`) that triggers disk deletion with the enhanced confirmation prompt from TICKET-2. Update the help text: "`msc reset` clears the tracking state without deleting your files. Use `msc reset --full` to also delete downloaded files."
- Affected commands/flows: `msc reset`, `msc reset --full`

**TICKET-4**
- Type: Feature Gap
- Persona: Sophie
- Severity: High
- Description: There is no inline help system for CLI terminology. Users who see "Orphaned", "state", "sync plan", or "user-added" in output have no way to learn what these mean from within the tool. `msc --help` explains commands but not concepts.
- Proposed resolution: Add `msc help <topic>` subcommand with short plain-language explanations for: `orphaned`, `user-files`, `state`, `reset`, `sync`. Example: `msc help orphaned` prints: "Orphaned entries are records in the tracking database for Moodle resources that no longer exist (e.g. from courses that ended). Your files on disk are not affected. You can safely dismiss them with `msc status --dismiss-orphans`."
- Affected commands/flows: new `msc help <topic>` command

**TICKET-5**
- Type: UX Improvement
- Persona: Sophie
- Severity: High
- Description: When `msc status` or the Done summary shows "Orphaned: N", there is no guidance on whether action is required or what to do. The number sits in the output with no context, causing anxiety in non-technical users.
- Proposed resolution: When orphaned count is > 0, append a one-line actionable note in plain language: "These are from courses that ended — your files are safe. To clean up the list, run `msc status --dismiss-orphans`." Show this note at most once per session (suppress on subsequent commands in the same run).
- Affected commands/flows: `msc scrape` Done summary, `msc status`

**TICKET-6**
- Type: UX Improvement
- Persona: Sophie
- Severity: Medium
- Description: `msc status --issues` outputs a flat 100-line tree with no summary-first approach. Non-technical users scroll through it without understanding the structure and become overwhelmed.
- Proposed resolution: Restructure `msc status --issues` output: show a 3-line plain-language summary first ("40 old entries from closed courses, 0 missing files, 0 problems requiring action"), then ask "Show full details? [y/N]" before printing the tree. In non-interactive mode (piped output) always print the full tree.
- Affected commands/flows: `msc status --issues`
