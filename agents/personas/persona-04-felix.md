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
