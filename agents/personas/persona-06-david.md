## Role
David — 5th semester WI student, intermediate user with a busy work schedule who relies on targeted partial syncs and has accumulated years of orphaned state.

## Profile
- **Semester**: 5
- **Major**: Wirtschaftsinformatik (WI)
- **OS**: macOS
- **Tech level**: Intermediate — comfortable with Terminal, has used the tool for 1.5 years, reads help text, occasionally googles error messages
- **Moodle courses**: 18 enrolled (heavy 5th semester load)
- **Usage history**: 1.5 years — installed at the start of semester 2, used continuously; knows the tool well enough to use `--courses` flag but does not read source code
- **Long-term state**: 3 completed semesters worth of orphaned files (~45 orphans from courses that are now closed in Moodle); output folder is 3.1 GB; he rarely reads the full status output and has ignored the "Orphaned: 45" line for months
- **Use pattern**: Runs `msc scrape --courses "DevOps, Datenbanken"` for the 2 courses he is actively working on (multiple times per week); runs a full `msc scrape` once a month to catch everything else; rarely checks status
- **Motivations**: Time efficiency — he works 20 hours per week at a startup and cannot afford to wait for a full scrape before class; organised course material without manual effort
- **Frustrations pre-tool**: Had to manually check multiple Moodle courses before each work session; often missed updated slides because he did not have time to check the portal

## Workflow Trace

1. **Targeted sync before a DevOps session — keyword mismatch**
   - What he tries: quickly sync just the DevOps course before a late-night study session.
   - Command: `msc scrape --courses "DevOps"`
   - What he sees: `[msc] No courses matched: "DevOps". Available courses: DevOps-Engineering, Datenbanken, ...`
   - Reaction: Annoyed. He knows the course exists. The keyword is "DevOps" and the course is "DevOps-Engineering" — a single hyphen breaks the match. He tries again with a different keyword.

2. **Retrying with a hyphen**
   - What he tries: include the hyphen in the keyword to be more precise.
   - Command: `msc scrape --courses "DevOps-"`
   - What he sees: Still no match. The `--courses` filter requires the keyword to appear as a substring in the course name, and "DevOps-" does not appear as a substring of "DevOps-Engineering" because the full string "DevOps-Engineering" contains "DevOps-E" — actually it should match, but the hyphen character itself may be treated as a regex special character or the space-split logic mangles it.
   - Reaction: Confused. Tries `--courses "Engineering"` — that works. Falls back to `--courses "Engineering"` as his muscle-memory alias, which is semantically wrong but functionally correct. Adds a mental note to file a bug.

3. **Checking orphaned files in status**
   - What he tries: finally investigate what "Orphaned: 45" means after seeing it for months.
   - Command: `msc status --issues`
   - What he sees: A nested tree of 45 paths, one per orphaned state entry, spread across 3 semesters of closed courses. The tree is deeply nested (Semester_2/CourseName/SectionName/filename). The output is approximately 70 lines.
   - Reaction: Finds the tree format hard to read at scale. Identifies that all orphans are from semesters 1–3. Wants a way to remove just the orphan entries from state (not delete the files from disk, because he still wants to keep the downloaded files) without doing a full reset.

4. **Exploring reset as a possible fix**
   - What he tries: see what `msc reset --dry-run` would do.
   - Command: `msc reset --dry-run`
   - What he sees: "Would delete: 3.1 GB across 1 500 files. Would remove state file. This is irreversible." Clear output, but terrifying. He does not want to lose 3 semesters of downloaded files.
   - Reaction: Decides not to run reset. Closes the terminal. The orphans stay.

5. **Wanting a selective orphan-dismiss command**
   - What he tries: looks for a way to just clean up the state entries for orphaned items without deleting any files on disk.
   - Action: runs `msc --help`, `msc clean --help`, `msc reset --help`, googles "msc dismiss orphans".
   - What he sees: No such command exists. `msc clean` targets user-added files. `msc reset` deletes everything. There is no middle-ground "prune orphaned state entries" command.
   - Reaction: Accepts the situation and continues ignoring the orphan count. Considers manually editing the state JSON file but decides it is too risky.

6. **Tuning request delay for faster partial syncs**
   - What he tries: speed up his targeted partial syncs by reducing the request delay.
   - Command: `msc config set requestDelayMs 500`
   - What he sees: "Config updated: requestDelayMs = 500". Subsequent syncs feel slightly faster.
   - Reaction: Satisfied. This works as expected. He wishes there was a `--fast` preset flag he could use without remembering the config key name.

## Gap & Friction Log

| # | Step | Issue | Severity | Type |
|---|------|-------|----------|------|
| 1 | `--courses` keyword match | Hyphenated course names fail to match intuitive keywords ("DevOps" does not match "DevOps-Engineering"); the filter is too strict | High | Bug / UX |
| 2 | `--courses` hyphen handling | Hyphens in keywords may be mishandled by the filter logic; "DevOps-" also fails to match | High | Bug |
| 3 | Orphan state cleanup | No command to dismiss orphaned state entries without a full reset or deleting files on disk | High | Feature Gap |
| 4 | Status tree at scale | `msc status --issues` tree output is overwhelming at 45+ orphans; no grouping by semester or pagination | Medium | UX |
| 5 | Partial sync orphan detection | Running `msc scrape --courses "X"` does not update orphan detection for courses not matched; orphan count is stale after partial syncs | Medium | Feature Gap |
| 6 | No archive workflow | No built-in concept of "archiving" a completed semester (removing it from live state while keeping files on disk) | Medium | Feature Gap |
| 7 | Config discoverability | `requestDelayMs` and similar performance keys require knowing the exact name; no `--fast` / `--slow` presets | Low | UX |
