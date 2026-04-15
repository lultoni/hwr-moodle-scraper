## Role
Felix — 4th semester WI student, developer-level power user who treats `msc` as a headless automation component.

## Profile
- **Semester**: 4
- **Major**: Wirtschaftsinformatik (WI)
- **OS**: macOS
- **Tech level**: Developer — writes Python scripts, uses git daily, maintains a dotfiles repo, comfortable with cron and shell scripting
- **Moodle courses**: 16 enrolled (full 4th semester load)
- **Usage history**: 1 year — installed at the start of semester 3, used continuously since
- **Long-term state**: State file spans 2 semesters; semester 1+2 courses are now closed and show as orphaned entries; output folder contains approximately 1 500 files accumulated over two semesters; he has shell aliases (`alias sync='msc scrape -q'`) and a cron job
- **Use pattern**: Cron job runs `msc scrape -q` nightly at 2am; checks `msc status` manually about once per week; runs targeted `msc scrape --courses "<keyword>"` before lectures; treats the tool as a silent daemon
- **Motivations**: Full automation and offline-first workflow; pipes scraper output into Obsidian via symlinks; wants zero manual intervention and zero terminal noise during automated runs
- **Frustrations pre-tool**: Had to download files manually from Moodle before each lecture; missed newly posted materials because he forgot to check; no way to diff what changed between sessions

## Workflow Trace

1. **Cron fires at 2am — quiet mode smoke check**
   - What he tries: cron runs `msc scrape -q` unattended.
   - Command: `msc scrape -q` (via cron, stdout/stderr redirected to a log file)
   - What he sees: An unexpected non-empty stderr line — the update checker prints a one-line "new version available" message. `--quiet` suppresses progress bars and the Done summary but the update checker message still leaks to stderr when a new version is detected.
   - Reaction: His log-monitoring script treats any stderr output as a failure signal and sends him a spurious alert at 2am. He is annoyed and adds `2>/dev/null` as a workaround, which now silently swallows real errors too.

2. **Pre-lecture targeted sync**
   - What he tries: sync only one course before class starts.
   - Command: `msc scrape --courses "OOP"`
   - What he sees: The scraper matches the course correctly and syncs. Takes about 20 seconds. Output ends with "Done: 4 downloaded, 0 skipped."
   - Reaction: Works fine. He is satisfied, but notes that the Done line includes no machine-readable indicator of which specific files are new.

3. **Dry-run before a full sync**
   - What he tries: preview what a full scrape would download without writing any files.
   - Command: `msc scrape --dry-run`
   - What he sees: Human-readable list of planned downloads printed to stdout: activity names, strategies, course paths. No total count at the end that he can `grep` or `wc -l` reliably because the format is not stable.
   - Reaction: Useful for a quick sanity check, but he cannot feed the output into another script without brittle text parsing.

4. **Parsing `msc status` in a shell script**
   - What he tries: extract the count of new/updated/orphaned files programmatically to feed a dashboard widget.
   - Command: `msc status` then attempts `msc status | grep "Orphaned"` to pull the number.
   - What he sees: Human-readable aligned table. The `grep` works today but breaks if the label wording ever changes. There is no `--json` flag.
   - Reaction: Frustrated. Writes a fragile `awk` one-liner and adds a comment in his dotfiles: "TODO: ask for --json in msc status".

5. **Setting update check interval**
   - What he tries: reduce the frequency of update checks so cron runs are not affected by network calls.
   - Command: `msc config set updateCheckIntervalHours 168`
   - What he sees: Config saved successfully. On the next cron run the update checker is effectively silenced for a week.
   - Reaction: Satisfied that the key exists, but annoyed he had to discover it by reading source code rather than `msc config list` output showing it with a description.

6. **Extracting the change report programmatically**
   - What he tries: capture which files were newly downloaded or updated this run.
   - Command: `msc scrape -q 2>&1 | grep "^[+~]"` (the change report lines start with `+` for new and `~` for updated)
   - What he sees: Works in interactive testing. But in cron with `-q` the change report is suppressed together with the rest of the Done summary, so he gets nothing.
   - Reaction: Discovers that `--quiet` suppresses the change report. He needs the change report but not the progress bar. There is no middle ground (e.g. `--quiet --changes`).

7. **Looking for `--json` or `--output-format`**
   - What he tries: check if any subcommand accepts structured output.
   - Command: `msc scrape --help`, `msc status --help`, `msc --help`
   - What he sees: No `--json` or `--output-format` flag anywhere in the help text.
   - Reaction: Adds a feature request comment to his dotfiles and works around it by parsing human-readable output, accepting the fragility.

## Gap & Friction Log

| # | Step | Issue | Severity | Type |
|---|------|-------|----------|------|
| 1 | Cron/quiet mode | Update checker message leaks to stderr even with `--quiet` when a new version is available; triggers false-positive monitoring alerts | High | Bug / UX |
| 2 | Dry-run output | Dry-run output has no stable machine-parseable format; total planned count not printed in a greppable way | Medium | UX / Feature Gap |
| 3 | `msc status` | No `--json` flag; parsing human-readable table output in scripts is fragile | High | Feature Gap |
| 4 | Change report | `--quiet` suppresses the change report (`+`/`~` lines) along with progress bar; no flag to keep change report while suppressing progress | High | Feature Gap |
| 5 | Update checker config | `updateCheckIntervalHours` key not surfaced in `msc config list` descriptions; discoverable only via source | Low | UX |
| 6 | Orphan noise | Orphaned entries from closed sem 1+2 courses accumulate in `msc status` output with no bulk-dismiss or archive option | Medium | Feature Gap |
| 7 | Automation integration | No webhook / notification hook; no way to call an external script on completion with structured results | Low | Feature Request |

## Feature Requests & Findings

**TICKET-1**
- Type: Bug
- Persona: Felix
- Severity: High
- Description: `--quiet` does not fully suppress the update checker notification. When a new version is detected, a line is printed to stderr regardless of the `--quiet` flag. Automated cron runs that treat any stderr output as an error are broken.
- Proposed resolution: In `--quiet` mode, suppress all update checker output unconditionally (both the "new version" message and any network error warnings). The update checker should only print when running interactively (i.e. when stdout is a TTY or `--quiet` is not set).
- Affected commands/flows: `msc scrape -q`, any subcommand run with `-q` in cron/CI

**TICKET-2**
- Type: Feature Request
- Persona: Felix
- Severity: High
- Description: No machine-readable output mode exists for any `msc` subcommand. `msc status`, `msc scrape` (change report), and `msc scrape --dry-run` all produce human-readable aligned text. Shell scripts that consume this output are brittle and break on wording changes.
- Proposed resolution: Add a `--json` flag to `msc status` (outputs a JSON object with `downloaded`, `orphaned`, `userAdded`, `sidecars` counts and file lists) and to `msc scrape` (outputs a JSON object with `newFiles[]`, `updatedFiles[]`, `skipped`, `errors[]`). `msc scrape --dry-run --json` outputs the planned download list as a JSON array.
- Affected commands/flows: `msc status`, `msc status --issues`, `msc scrape`, `msc scrape --dry-run`

**TICKET-3**
- Type: Feature Request
- Persona: Felix
- Severity: High
- Description: The change report (`+`/`~` prefixed lines listing new and updated files) is suppressed by `--quiet`. There is no way to get machine-readable change output without the full progress bar noise. A developer running msc from a script needs only the change data, not the progress bar.
- Proposed resolution: (a) With `--json`, include `newFiles` and `updatedFiles` arrays in the JSON output regardless of `--quiet`. (b) Alternatively, add a `--changes-only` or `--porcelain` flag that prints only the change report lines (`+`/`~` prefixed) to stdout, suppressing everything else, designed for script consumption.
- Affected commands/flows: `msc scrape`, `msc scrape -q`

**TICKET-4**
- Type: UX Improvement
- Persona: Felix
- Severity: Medium
- Description: `msc config list` shows config keys and current values but no description of what each key does or what unit values are in. `updateCheckIntervalHours` is not obvious without reading source code.
- Proposed resolution: Add a short description column to `msc config list` output (e.g. `updateCheckIntervalHours  168  How often to check for updates (hours)`). In `--json` mode, include a `description` field per key.
- Affected commands/flows: `msc config list`

**TICKET-5**
- Type: Feature Request
- Persona: Felix
- Severity: Medium
- Description: Orphaned state entries from closed semesters accumulate indefinitely. There is no way to bulk-dismiss or archive them without running `msc reset` (which deletes everything) or manually editing the state file.
- Proposed resolution: Add `msc status --dismiss-orphans` or a dedicated `msc archive` command that removes orphaned state entries (marking them as intentionally archived) without touching files on disk or removing active-semester entries. Should print a summary of what was removed.
- Affected commands/flows: `msc status`, `msc reset`

**TICKET-6**
- Type: Feature Request
- Persona: Felix
- Severity: Low
- Description: No external hook or notification mechanism exists. Felix cannot trigger a downstream script (e.g. Obsidian vault refresh, desktop notification) when a scrape completes with new files.
- Proposed resolution: Add an optional `postScrapeHook` config key that accepts a shell command string. After each scrape, if new or updated files exist, the hook is executed with environment variables `MSC_NEW_COUNT`, `MSC_UPDATED_COUNT`, and `MSC_CHANGED_FILES` (newline-separated paths) set.
- Affected commands/flows: `msc scrape`, `msc config`
