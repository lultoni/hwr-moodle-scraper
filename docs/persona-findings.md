# Persona Findings

Generated: 2026-04-15
Personas evaluated: 14
Total tickets (pre-dedup): 73
Unique tickets (post-dedup): 32

---

## Section 1: Feature Score Table

| Feature | 01 Lea | 02 Tobias | 03 Amara | 04 Felix | 05 Jana | 06 David | 07 Sophie | 08 Kenji | 09 Mira | 10 Luca | 11 Nele | 12 Rafael | 13 Hannah | 14 Ben | Worst |
| :------- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| install | 😐 | — | 😊 | — | — | — | — | 😐 | 😕 | — | — | — | — | — | 😕 |
| wizard | 😊 | — | 😊 | — | — | — | — | — | 😊 | — | — | — | — | — | 😊 |
| auth-set | — | ❌ | 😊 | — | — | — | — | ❌ | — | — | — | — | — | — | ❌ |
| auth-status | — | 😕 | — | — | — | — | — | 😕 | — | — | — | — | — | — | 😕 |
| scrape-first-run | 😊 | — | 😊 | — | — | — | — | 😊 | 😊 | — | — | — | — | — | 😊 |
| scrape-incremental | 😊 | 😐 | 😊 | 😊 | 😊 | — | 😊 | 😊 | 😐 | 😐 | 😊 | 😊 | 😊 | 😊 | 😐 |
| scrape-force | — | — | — | — | — | — | 😊 | — | — | — | — | — | — | — | 😊 |
| scrape-dry-run | — | 😐 | — | 😐 | — | — | — | — | — | — | — | — | — | — | 😐 |
| scrape-courses-filter | — | — | — | 😊 | — | 😕 | — | 😊 | — | — | — | — | — | — | 😕 |
| scrape-quiet | — | 😊 | — | 😕 | — | — | — | — | — | — | — | — | — | — | 😕 |
| config-list | — | 😊 | 😐 | 😐 | — | — | — | — | — | — | — | — | — | — | 😐 |
| config-set | — | 😊 | — | 😊 | — | 😊 | — | 😊 | — | 😊 | — | — | — | — | 😊 |
| status | 😐 | — | 😊 | 😐 | 😐 | — | 😐 | — | 😐 | 😐 | 😐 | 😕 | 😐 | 😐 | 😕 |
| status-issues | — | 😐 | 😊 | — | 😐 | 😐 | 😕 | 😐 | — | 😐 | — | — | 😐 | 😐 | 😕 |
| status-changed | — | — | 😊 | 😐 | — | — | — | — | — | — | — | — | ❌ | ❌ | ❌ |
| status-dismiss-orphans | — | — | — | ❌ | — | ❌ | — | — | — | — | — | — | — | — | ❌ |
| clean | — | — | — | — | 😕 | — | — | — | — | 😊 | — | ❌ | — | — | ❌ |
| reset | — | — | — | — | — | 😕 | ❌ | — | — | — | — | — | — | — | ❌ |
| tui | 😊 | — | 😊 | — | — | — | — | — | 😐 | — | — | — | — | — | 😐 |
| output-binary | 😊 | — | 😊 | — | — | — | — | — | 😊 | 😐 | 😊 | 😊 | — | — | 😐 |
| output-page-md | 😕 | — | 😐 | — | — | — | — | — | — | — | — | — | — | — | 😕 |
| output-url-txt | 😕 | — | 😕 | — | — | — | — | — | — | — | 😕 | 😕 | — | — | 😕 |
| output-description-md | 😕 | — | 😐 | — | — | — | — | — | — | — | 😕 | 😕 | 😊 | — | 😕 |
| env-var-credentials | — | ❌ | — | — | — | — | — | — | — | — | — | — | — | — | ❌ |
| post-scrape-hook | — | — | — | ❌ | — | — | — | — | — | — | — | — | — | — | ❌ |
| last-sync-md | — | — | — | — | — | — | — | — | — | — | ❌ | — | ❌ | ❌ | ❌ |
| user-files-protection | — | — | — | — | 😕 | — | — | — | — | 😊 | — | — | — | — | 😕 |
| cross-platform-paths | — | — | — | — | — | — | — | 😕 | 😐 | 😊 | — | — | — | — | 😕 |
| goodnotes-annotation | — | — | — | — | — | — | — | — | — | — | 😕 | — | — | 😕 | 😕 |
| tui-rendering | — | — | 😊 | — | — | — | — | — | 😐 | — | — | — | — | — | 😐 |
| config-list-descriptions | — | — | — | 😕 | — | — | — | — | — | — | — | — | — | — | 😕 |
| archive | — | — | — | ❌ | — | ❌ | — | — | — | — | — | — | — | — | ❌ |

---

## Section 2: Unified Ticket List

### TICKET-1: .description.md sidecar files have no origin header — iOS users see raw Markdown with no context

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | high |
| Affected command | msc scrape, sidecar writing in src/commands/scrape.ts |
| Persona(s) | 01-lea, 03-amara, 11-nele, 13-hannah |

**Description:** Apple Notes does not render Markdown natively. Users who copy `.md` content into Apple Notes see raw syntax (`**bold**`, `## header`, `- [ ] task`). There is no in-tool option to produce plain text or HTML output. This is a known limitation of Apple Notes, not a scraper bug, but it is undocumented.

**Proposed fix:** Add a "Using with Apple Notes" tip to README: recommend copy-pasting into Notes and note that Markdown will not render. Mention that Obsidian, Bear, or Notion are alternatives that render Markdown natively. Long-term: consider a `--format txt` config key that runs output through a Markdown-to-plaintext strip pass before writing — low priority given implementation cost.

---

### TICKET-2: No flag or config key to suppress .md / .url.txt / .description.md output for iPad/binary-only workflows

| Field | Value |
|-------|-------|
| Type | docs |
| Severity | high |
| Affected command | msc clean, help text in src/commands/clean.ts |
| Persona(s) | 01-lea, 11-nele, 12-rafael |

**Description:** There is no way to suppress `.md`, `.url.txt`, and `.description.md` output files. Users whose primary consumption device is iOS (Files app, GoodNotes) see these files as clutter and cannot open them meaningfully. A `--pdf-only` or `--no-descriptions` flag would allow users to opt into a binary-only output.

**Proposed fix:** Rewrite the `msc clean` help text to explicitly state: "Removes files YOU added to the output folder that the scraper does not recognize. It does NOT remove .md or .url.txt files created by the scraper — use `--no-descriptions` for that." Add an example in `--help` showing a typical use case. Consider adding a `--what-this-does` flag that prints a plain-English explanation.

---

### TICKET-3: All output paths shown in POSIX format — Windows apps on WSL cannot consume them directly

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | high |
| Affected command | msc status, msc status --issues, msc scrape Done summary and change report |
| Persona(s) | 01-lea, 06-david, 07-sophie, 08-kenji, 12-rafael |

**Description:** All output paths displayed by `msc` (in status, done summary, change report) are in the native OS path format. On WSL, this is a POSIX path (`/mnt/c/...`). Windows applications require Windows-format paths (`C:\...`). Users who access files from both environments must manually convert paths.

**Proposed fix:** Add a `displayPathFormat` config key accepting `auto` (default), `posix`, or `windows`. When set to `windows` (or when auto-detected as WSL), convert paths in all user-facing output to Windows format using a simple `/mnt/c/` → `C:\` transformation. Print a note on first WSL detection: "WSL detected. Set `msc config set displayPathFormat windows` to show Windows-format paths."

---

### TICKET-4: No state-only reset mode — `msc reset` always deletes files, but users usually want state-only repair

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | high |
| Affected command | msc auth set, msc auth status, msc scrape credential prompt |
| Persona(s) | 01-lea, 04-felix, 07-sophie, 08-kenji |

**Description:** `msc auth set` and `msc auth status` behave incorrectly on Linux/WSL. When `keytar` has no available backend (no Keychain, no libsecret, no GNOME Keyring), `keytar.setPassword()` silently fails or throws an error that is swallowed. The tool prints "Credentials saved." even though nothing was persisted. On the next run, the user is re-prompted. `msc auth status` returns "No credentials stored." immediately after a successful-looking `msc auth set`.

**Proposed fix:** (a) Rewrite the confirmation prompt to be explicit: "WARNING: This will permanently delete [N GB] of files across [N courses]. Files from CLOSED Moodle courses CANNOT be recovered after deletion. Type 'DELETE' (all caps) to confirm, or press Enter to cancel." (b) Add a pre-flight warning if any enrolled courses appear to be closed/inaccessible: "Note: [N] courses in your state may no longer be accessible on Moodle. Their files cannot be re-downloaded." (c) Change the default confirmation character from `y` to requiring the word "DELETE" to prevent accidental confirmations.

---

### TICKET-5: `--non-interactive` always fails on Linux because keytar is unavailable

| Field | Value |
|-------|-------|
| Type | feature |
| Severity | high |
| Affected command | `msc scrape --non-interactive` |
| Persona(s) | 02-tobias |

**Description:** `--non-interactive` requires stored credentials. On Linux, credentials can never be stored (keytar unavailable). The flag therefore always fails on Linux with "no credentials found". The flag's purpose — enabling automation — is entirely defeated on the most common server/automation OS.

**Proposed fix:** Add support for environment variable credential injection: `MSC_USERNAME` and `MSC_PASSWORD`. When both are set, skip the prompt entirely. Precedence: env vars > keychain > prompt. Document in README. This is the standard pattern for CLI tools used in CI/automated contexts and does not weaken security beyond what the user already does when storing credentials in env files.

---

### TICKET-6: Windows native keytar/Credential Manager gap not communicated — silent re-prompt every run

| Field | Value |
|-------|-------|
| Type | bug |
| Severity | high |
| Affected command | msc scrape (first-run wizard), msc auth set |
| Persona(s) | 02-tobias, 08-kenji, 09-mira |

**Description:** On Linux, `msc auth set` prompts for credentials, appears to accept them, then fails silently (or with an error that does not prevent the user from thinking credentials were saved). On the next `msc scrape` run, the user is prompted again — with no explanation that the previous `msc auth set` had no effect.

**Proposed fix:** Add libsecret as a second keytar backend. `keytar` already supports `libsecret` on Linux when the `libsecret-dev` package is installed. Document the installation step in the README Linux/WSL section. As a simpler alternative, add an encrypted credential file fallback (AES-256-GCM, key derived from machine-specific entropy) when neither Keychain nor libsecret is available. This is less secure than Keychain but vastly better than re-prompting every run.

---

### TICKET-7: `--quiet` does not suppress update checker output to stderr in automated runs

| Field | Value |
|-------|-------|
| Type | bug |
| Severity | high |
| Affected command | `msc scrape -q`, any subcommand run with `-q` in cron/CI |
| Persona(s) | 04-felix |

**Description:** `--quiet` does not fully suppress the update checker notification. When a new version is detected, a line is printed to stderr regardless of the `--quiet` flag. Automated cron runs that treat any stderr output as an error are broken.

**Proposed fix:** In `--quiet` mode, suppress all update checker output unconditionally (both the "new version" message and any network error warnings). The update checker should only print when running interactively (i.e. when stdout is a TTY or `--quiet` is not set).

---

### TICKET-8: No machine-readable (`--json`) output mode for any subcommand

| Field | Value |
|-------|-------|
| Type | feature |
| Severity | high |
| Affected command | `msc status`, `msc status --issues`, `msc scrape`, `msc scrape --dry-run` |
| Persona(s) | 04-felix |

**Description:** No machine-readable output mode exists for any `msc` subcommand. `msc status`, `msc scrape` (change report), and `msc scrape --dry-run` all produce human-readable aligned text. Shell scripts that consume this output are brittle and break on wording changes.

**Proposed fix:** Add a `--json` flag to `msc status` (outputs a JSON object with `downloaded`, `orphaned`, `userAdded`, `sidecars` counts and file lists) and to `msc scrape` (outputs a JSON object with `newFiles[]`, `updatedFiles[]`, `skipped`, `errors[]`). `msc scrape --dry-run --json` outputs the planned download list as a JSON array.

---

### TICKET-9: No targeted command to prune orphaned state entries while keeping files on disk

| Field | Value |
|-------|-------|
| Type | feature |
| Severity | high |
| Affected command | `msc status`, `msc reset` |
| Persona(s) | 04-felix, 06-david |

**Description:** There is no way to remove orphaned state entries without running `msc reset` (which deletes all files) or manually editing the state JSON. Users with closed-semester orphans want to prune stale state entries while keeping the downloaded files intact on disk.

**Proposed fix:** Add `msc status --dismiss-orphans [--dry-run]` or a dedicated `msc prune` command. It removes orphaned state entries (i.e. entries where the Moodle resource no longer exists) from the state file without touching any files on disk. Prints a summary: "Removed 45 orphaned state entries. Files on disk are unchanged." Include a `--dry-run` flag to preview.

---

### TICKET-10: GoodNotes users cannot distinguish new from updated files in iCloud sync — risk of duplicate blank import

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | high |
| Affected command | msc status, msc status --issues, msc clean, README |
| Persona(s) | 05-jana, 08-kenji, 09-mira, 10-luca, 11-nele, 12-rafael, 14-ben |

**Description:** For GoodNotes users, importing an updated PDF (`~` in change report) creates a blank duplicate alongside the annotated original. GoodNotes has no mechanism to detect or prevent this. The scraper gives no warning that a file is an update (as opposed to a new file) at the point of iCloud sync. Users relying only on iCloud Files app cannot distinguish new from updated files.

**Proposed fix:** The `_LastSync.md` file directly addresses this: it separates `+` new files from `~` updated files in a persistent, iPad-readable document. Additionally, add a note to README under a "GoodNotes / iPad annotation workflow" section: "Files marked `~` (updated) in the change report replace the existing iCloud copy. If you have annotated this PDF in GoodNotes, do NOT re-import the updated version — your GoodNotes annotations are on the old copy inside GoodNotes' internal library and are unaffected."

---

### TICKET-11: `_User-Files/` folders are not actually excluded from status and clean targeting

| Field | Value |
|-------|-------|
| Type | feature |
| Severity | high |
| Affected command | msc status, msc status --issues, msc clean, msc clean --dry-run |
| Persona(s) | 05-jana |

**Description:** Files placed inside a `_User-Files/` subfolder that a user created manually still appear in the "user-added files" list in `msc status --issues`. The scraper should treat any folder named `_User-Files/` (at any level within the output directory) as an opt-in user-owned zone and exclude it from status and clean targeting.

**Proposed fix:** In `collectFiles` / `buildKnownPaths`, exclude any path whose components include a directory named `_User-Files`. Add a matching exclusion in `runClean` so these paths are never presented as clean targets. Update `msc status` to count them separately: "N files in `_User-Files/` (protected), M files outside `_User-Files/` (unprotected)."

---

### TICKET-12: `msc clean --dry-run` leads with deletion language, causing user panic

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | high |
| Affected command | msc clean --dry-run, msc clean confirmation prompt |
| Persona(s) | 05-jana |

**Description:** `msc clean --dry-run` output leads with language about deletion ("would delete"), causing panic in users who have not read about `--move`. The dry-run should surface the `--move` alternative prominently.

**Proposed fix:** In `--dry-run` output, show two sections: "Would DELETE (default):" and a reminder box "Use `msc clean --move` to move these to `User Files/` instead of deleting." Show `--move` as the recommended action when any files are detected. Make the default action explicit in the confirmation prompt: "Delete 80 files permanently? [y/N]" (default No).

---

### TICKET-13: `--courses` keyword matching fails on hyphenated course names

| Field | Value |
|-------|-------|
| Type | bug |
| Severity | high |
| Affected command | msc scrape --courses |
| Persona(s) | 06-david |

**Description:** `--courses` keyword matching is too strict for hyphenated course names. "DevOps" does not match "DevOps-Engineering" because the keyword matching logic may be treating `-` as a word boundary or splitting on it. Users naturally search for the meaningful part of the name without knowing the exact formatting.

**Proposed fix:** Normalise both the keyword and course name before comparison: strip hyphens and convert to lowercase before substring matching. Additionally, support space-tolerant matching (so "DevOps Engineering" matches "DevOps-Engineering"). Document the matching behaviour in `msc scrape --help`.

---

### TICKET-14: No inline help system for CLI terminology — users cannot look up "orphaned", "state", etc.

| Field | Value |
|-------|-------|
| Type | feature |
| Severity | high |
| Affected command | new msc help <topic> command |
| Persona(s) | 07-sophie |

**Description:** There is no inline help system for CLI terminology. Users who see "Orphaned", "state", "sync plan", or "user-added" in output have no way to learn what these mean from within the tool. `msc --help` explains commands but not concepts.

**Proposed fix:** Add `msc help <topic>` subcommand with short plain-language explanations for: `orphaned`, `user-files`, `state`, `reset`, `sync`. Example: `msc help orphaned` prints: "Orphaned entries are records in the tracking database for Moodle resources that no longer exist (e.g. from courses that ended). Your files on disk are not affected. You can safely dismiss them with `msc status --dismiss-orphans`."

---

### TICKET-15: Change report lists files in processing order with no per-course grouping — hard to scan with 13+ courses

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | high |
| Affected command | msc status, msc status --issues, change report in msc scrape |
| Persona(s) | 09-mira, 13-hannah, 14-ben |

**Description:** The change report (`+`/`~` prefixed lines) printed at the end of `msc scrape` is ephemeral — it exists only in the terminal session. Users on an iPad-first workflow need to review the list of new vs updated files on their iPad before deciding what to import into GoodNotes. There is currently no way to retrieve this information after the terminal session ends.

**Proposed fix:** Write a `_LastSync.md` file to the root of the output directory after each scrape. Contents: ISO timestamp of the scrape, total counts, and two sections — "New files" (paths prefixed `+`) and "Updated files" (paths prefixed `~`). Overwrite on each run (only last sync shown). Track in `State.generatedFiles`. This file syncs to iCloud automatically, is readable in Files app on iPad, and serves as a persistent source of truth for the change report.

---

### TICKET-16: Cloud sync (OneDrive/Dropbox) file lock causes silent EPERM on atomicWrite rename — file missing from disk with no warning

| Field | Value |
|-------|-------|
| Type | bug |
| Severity | high |
| Affected command | msc scrape, atomicWrite in src/fs/output.ts, msc status --issues |
| Persona(s) | 10-luca |

**Description:** When a cloud sync client (OneDrive, Dropbox, iCloud Drive) holds a transient file lock on a download destination during `atomicWrite`, the `fs.rename` from `.tmp` to final path fails with `EPERM`. If this error is not surfaced clearly, the file is silently missing from disk while state records it as downloaded. `--check-files` re-downloads it, but the user may not know to run it.

**Proposed fix:** In `atomicWrite`, catch `EPERM`/`EBUSY` rename errors and (a) log a clear warning naming the affected file, (b) add the file to a "failed" list that is printed in the scrape summary and marked in state as `status: "error"` so `msc status --issues` surfaces it immediately without needing `--check-files`.

---

### TICKET-17: No msc status --changed flag to re-query last-run new/updated files after terminal session ends

| Field | Value |
|-------|-------|
| Type | feature |
| Severity | high |
| Affected command | msc status |
| Persona(s) | 13-hannah, 14-ben |

**Description:** There is no `msc status --changed` or `msc log` command to query what changed in the last run after the fact. `msc status` shows counts and orphans; `msc status --issues` shows missing/orphaned files. Neither shows "files changed in the most recent scrape". Users who want to review changes after closing the terminal have no option.

**Proposed fix:** Persist a `lastSync` object in the state file: `{ timestamp: string, newFiles: string[], updatedFiles: string[] }`. Populate it at the end of each `runScrape`. Add `msc status --changed` flag that reads and prints this object. Output format: same `+`/`~` prefixed relative paths as the change report. This allows users to re-query the last-run changes without re-running the scrape.

---

### TICKET-18: TUI Config screen shows raw internal key names with no descriptions or hints

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | medium |
| Affected command | `msc tui` (Config screen) |
| Persona(s) | 01-lea, 04-felix, 06-david |

**Description:** The TUI Config screen shows internal key names like `maxConcurrentDownloads` and `requestDelayMs` with their values, but no human-readable labels, descriptions, or safe-value hints. A beginner has no idea what these control or what a safe value looks like.

**Proposed fix:** Add a `--fast` flag to `msc scrape` that temporarily applies `requestDelayMs=200, maxConcurrentDownloads=8` for the current run without saving to config. Document the tradeoff (faster but heavier on the Moodle server) in the flag help text.

---

### TICKET-19: `msc auth status` misleadingly reports keytar as backend when it is unavailable on Linux

| Field | Value |
|-------|-------|
| Type | bug |
| Severity | medium |
| Affected command | `msc status --issues` |
| Persona(s) | 02-tobias |

**Description:** On Linux where keytar is absent, `msc auth status` still reports the credential backend as "system keychain (keytar)" and shows username/password as "not set". This is confusing — it implies the keychain mechanism is present but empty, when in fact it is completely unavailable.

**Proposed fix:** Detect keytar availability at runtime. If unavailable, `msc auth status` should report: `Credential storage: not available on this platform. Credentials are prompted on each run.` If env vars are set (TICKET-8), report them as the active credential source.

---

### TICKET-20: No targeted command to remove only orphaned files without a full reset

| Field | Value |
|-------|-------|
| Type | feature |
| Severity | medium |
| Affected command | `msc status --issues`, `msc reset` |
| Persona(s) | 02-tobias |

**Description:** Orphaned files (files in state that no longer exist on Moodle) can only be cleaned up by running `msc reset`, which wipes all state and triggers a full re-download. There is no targeted command to remove only orphaned files and their state entries while leaving everything else intact.

**Proposed fix:** Add `--orphans` flag to `msc clean` or create `msc clean --orphans` to delete orphaned files from disk and remove their state entries. Show a dry-run preview first (consistent with `msc clean` UX). Alternatively, add `msc reset --orphans-only` to limit the reset scope. Either approach removes the need for a full re-download just to clear orphans.

---

### TICKET-21: Moodle German-language error strings shown verbatim with no English context

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | medium |
| Affected command | `msc scrape` (auth errors) |
| Persona(s) | 03-amara |

**Description:** When Moodle returns a German-language error (e.g. "Ungültige Anmeldedaten" for invalid credentials), the CLI wraps it verbatim in the error output. International students and non-German speakers cannot understand the error without translation.

**Proposed fix:** Map known Moodle error strings to English equivalents in the error-handling layer. At minimum, wrap the raw Moodle string with an English context: `Authentication failed (Moodle: "Ungültige Anmeldedaten" — likely invalid username or password)`. A lookup table of common Moodle error strings would cover most cases.

---

### TICKET-22: Orphan tree in `msc status --issues` is unreadable at scale — no grouping by course

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | medium |
| Affected command | msc status --issues |
| Persona(s) | 06-david |

**Description:** `msc status --issues` renders orphaned files in a deeply nested per-file tree. At 45+ orphans this is ~70 lines and difficult to scan. There is no grouping by semester or course, and no way to see a high-level summary before drilling in.

**Proposed fix:** Group orphaned entries by semester/course in the tree output (collapsing file-level detail into a count: "Semester_2/Datenbanken: 12 orphaned files"). Add a `--verbose` sub-flag to expand to per-file detail. Show a one-line summary first: "45 orphaned entries across 3 courses in 2 closed semesters."

---

### TICKET-23: No workflow for archiving completed semesters — orphans accumulate with no clean path

| Field | Value |
|-------|-------|
| Type | feature |
| Severity | medium |
| Affected command | msc status, msc reset, new msc archive command |
| Persona(s) | 06-david |

**Description:** There is no workflow for "archiving" a completed semester — removing old courses from the active state (so they stop appearing as orphans) while keeping the downloaded files on disk for future reference. Users who complete semesters want a clean state without data loss.

**Proposed fix:** Add `msc archive --semester N` (or `msc archive --courses "keyword"`) that: (a) removes matching courses from the state file, (b) leaves all files on disk untouched, (c) prints a summary of what was archived. Archived courses no longer appear in status or orphan counts.

---

### TICKET-24: `msc status --issues` outputs a flat 100-line tree with no summary-first approach

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | medium |
| Affected command | msc status --issues |
| Persona(s) | 07-sophie |

**Description:** `msc status --issues` outputs a flat 100-line tree with no summary-first approach. Non-technical users scroll through it without understanding the structure and become overwhelmed.

**Proposed fix:** Restructure `msc status --issues` output: show a 3-line plain-language summary first ("40 old entries from closed courses, 0 missing files, 0 problems requiring action"), then ask "Show full details? [y/N]" before printing the tree. In non-interactive mode (piped output) always print the full tree.

---

### TICKET-25: outputDir paths with spaces may break shell-adjacent code paths (e.g. df in checkDiskSpace)

| Field | Value |
|-------|-------|
| Type | bug |
| Severity | medium |
| Affected command | msc scrape, msc config set outputDir, checkDiskSpace |
| Persona(s) | 08-kenji |

**Description:** When `outputDir` contains spaces (e.g. `/mnt/c/Users/Kenji/My Documents/moodle`), internal path operations may break due to unquoted string interpolation in shell-adjacent code paths (e.g. `checkDiskSpace` uses `df` with the path as an argument).

**Proposed fix:** Audit all uses of `outputDir` in shell invocations (`df`, `exec`, etc.) and ensure the path is always quoted or passed as an argument array rather than a string. Add a test case with a path containing spaces to prevent regression.

---

### TICKET-26: TUI box-drawing characters render as garbled text in legacy Windows CMD

| Field | Value |
|-------|-------|
| Type | compatibility |
| Severity | medium |
| Affected command | msc tui |
| Persona(s) | 09-mira |

**Description:** TUI box-drawing characters render as garbled text in the legacy Windows CMD (CP850 code page). Only Windows Terminal and PowerShell with UTF-8 (`chcp 65001`) render correctly.

**Proposed fix:** Add a note in README and/or TUI startup that Windows Terminal or PowerShell with `chcp 65001` is required for correct rendering. Optionally detect `TERM` or `WT_SESSION` environment variables and warn on launch.

---

### TICKET-27: All orphaned state entries look identical — no way to distinguish Moodle-deleted vs path-drifted vs never-downloaded

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | medium |
| Affected command | msc status, msc status --issues, sync plan in src/sync/ |
| Persona(s) | 10-luca |

**Description:** `msc status` displays all orphaned state entries uniformly. There is no way to tell whether an orphan exists because (a) the Moodle resource was deleted/moved on the server, (b) the file was never successfully downloaded, or (c) the local path changed (drive letter, mount point, or folder rename). These three causes require different user actions.

**Proposed fix:** Add an optional `orphanReason` field to `FileState` (values: `"moodle-removed"`, `"never-downloaded"`, `"path-missing"`). Populate `"path-missing"` when a state entry's `localPath` does not exist on disk but the Moodle resource still exists in the content tree. Populate `"moodle-removed"` during sync plan reconciliation. Display the reason in `msc status` output.

---

### TICKET-28: Missing files in status --issues do not indicate whether file was previously downloaded or always missing

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | medium |
| Affected command | msc status --issues, FileState in src/sync/state.ts |
| Persona(s) | 10-luca |

**Description:** `msc status --issues` lists "missing files" (state entries whose `localPath` does not exist on disk) but does not indicate whether the file was previously successfully downloaded or was always missing. A successfully-downloaded file that disappeared (path drift, accidental deletion) looks identical to a file that failed during download and was never written.

**Proposed fix:** Add a `downloadedAt` timestamp or a `everDownloaded: boolean` field to `FileState`. Use this in `msc status --issues` to annotate missing files: "previously downloaded, now missing" vs "never successfully downloaded".

---

### TICKET-29: Change report symbols `+` and `~` have no legend (also reported by Lea)

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | low |
| Affected command | `msc scrape` |
| Persona(s) | 01-lea, 03-amara |

**Description:** The change report after a scrape lists new and updated files with `+` and `~` prefixes. There is no legend in the output explaining what these symbols mean.

**Proposed fix:** Add a one-line legend before the file list: `Legend: + new  ~ updated`. This takes one line and removes all ambiguity for all users.

---

### TICKET-30: Scraper-generated filenames use German names in an otherwise English CLI

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | low |
| Affected command | `msc scrape` (section summary output) |
| Persona(s) | 03-amara |

**Description:** The scraper writes files named `_Abschnittsbeschreibung.md` (section description), `_Ordnerbeschreibung.md` (folder description), and `_Beschreibungen.md` (descriptions). These are German names in a tool whose CLI surface is entirely in English. Non-German users cannot infer the file purpose from the name alone.

**Proposed fix:** Rename generated files to English equivalents: `_SectionDescription.md`, `_FolderDescription.md`, `_Descriptions.md`. Course content filenames (from Moodle) will remain in the original language (correct), but scraper-generated file names should follow the CLI language (English). Alternatively, add a `language` config key (`de` / `en`) for generated filenames.

---

### TICKET-31: No post-scrape hook mechanism to trigger downstream scripts

| Field | Value |
|-------|-------|
| Type | feature |
| Severity | low |
| Affected command | `msc scrape`, `msc config` |
| Persona(s) | 04-felix |

**Description:** No external hook or notification mechanism exists. Felix cannot trigger a downstream script (e.g. Obsidian vault refresh, desktop notification) when a scrape completes with new files.

**Proposed fix:** Add an optional `postScrapeHook` config key that accepts a shell command string. After each scrape, if new or updated files exist, the hook is executed with environment variables `MSC_NEW_COUNT`, `MSC_UPDATED_COUNT`, and `MSC_CHANGED_FILES` (newline-separated paths) set.

---

### TICKET-32: Long German Moodle filenames truncated in GoodNotes and iOS Files app name column

| Field | Value |
|-------|-------|
| Type | ux |
| Severity | low |
| Affected command | sanitiseFilename in src/scraper/, msc config |
| Persona(s) | 11-nele |

**Description:** Long German Moodle course and activity names (e.g. `Prüfungsleistung Moduleinheit _Strategisches Geschäftsprozessmanagement_`) exceed 40 characters and are truncated in the GoodNotes file picker and iOS Files app name column. Users cannot identify files at a glance.

**Proposed fix:** This is partially a Moodle naming issue, but the scraper could offer a `--short-filenames` config option that applies a maximum filename length (e.g. 60 chars) with a hash suffix for uniqueness. Alternatively, document the issue and suggest users rename files after import. Low priority as it requires trade-offs with uniqueness and path matching.

---

---

## Section 3: Condensed Workflow Traces

**01 Lea:** Lea successfully installed the tool after a Google detour for Node.js, ran the first-run wizard without issue (accepting all defaults), and completed both a first-run and incremental scrape. She encountered friction around unfamiliar output file types — `.md` files opened as raw text in TextEdit and `.url.txt` files required manual URL copying — leaving her confused about whether the tool had worked correctly. She used `msc status` and `msc tui` but found terminology ("orphaned", "user-added", "sidecars") and raw config key names opaque. She never attempted any advanced commands (auth, reset, clean, --courses, --force) as they were outside her mental model. Her overall outcome was a working offline copy of her course files, though with persistent confusion about the non-PDF output formats.

**02 Tobias:** Tobias is a returning user whose primary goal — automating `msc scrape` via cron on Linux — is entirely blocked by the absence of a persistent credential store on Linux (keytar unavailable). He discovered that `msc auth set` silently fails, `msc auth status` misleadingly reports keytar as the backend, and `--non-interactive` is unusable without stored credentials. He explored `--dry-run`, `config set`, and `scrape -q` as partial workarounds, all of which functioned correctly, but none solved the automation problem. He also found that orphaned files from a restructured semester-1 course have no targeted cleanup path — `msc clean` ignores orphans and `msc reset` is a full wipe. His overall outcome was a manual per-session workflow that falls far short of his automation goal, with four high/medium severity bugs directly blocking him.

**03 Amara:** Amara completed a full first-run install and scrape with no major blockers, aided by an English README and English wizard prompts. Her primary pain points were post-scrape file usability: `.md` files opened as raw text in TextEdit and `.url.txt` files could not be double-clicked to open in a browser, requiring manual URL copying. She successfully used `msc status`, `msc status --issues`, and the TUI, finding all three clear and reassuring. A secondary friction point arose when a Moodle auth error surfaced an untranslated German error string, which she could handle but flagged as a concern for users with less German. The change report on incremental scrape worked correctly but lacked a symbol legend. Overall outcome was positive — she achieved her goal of getting all files offline — but the raw-Markdown and non-openable-URL issues represent real daily friction for a non-technical user.

**04 Felix:** Felix operates msc entirely as a headless automation tool — cron at 2am, shell aliases, and occasional targeted pre-lecture syncs — and immediately hit a blocking issue: the update checker leaks a message to stderr even in `--quiet` mode, causing his log-monitoring script to fire false-positive alerts at 2am. He worked around this with `2>/dev/null`, silencing real errors too. His targeted course filter and dry-run both functioned, but the dry-run and `msc status` outputs are human-readable only, making programmatic consumption brittle; he wrote fragile `awk` one-liners and left TODO comments in his dotfiles. He found `updateCheckIntervalHours` only by reading source code, as `msc config list` shows no descriptions. Orphaned entries from two closed semesters accumulate with no bulk-dismiss or archive path, adding noise to his weekly status checks. He could not find any post-scrape hook mechanism, blocking his Obsidian vault refresh workflow. Overall, the tool works for his automation use case but lacks the machine-readable and scriptability features a developer-level power user requires.

**05 Jana:** Jana runs a weekly `msc scrape` as part of a regular study routine, using Obsidian as her vault over the output folder. She first noticed "User-added files: 80" in the scrape summary and escalated to `msc status` and `msc status --issues` trying to understand whether her personal notes were at risk. She discovered `msc clean --dry-run` but panicked at the deletion-first language and stopped. She then tried `msc clean --move`, which succeeded technically but broke her Obsidian relative links. A deeper investigation revealed that her manually created `_User-Files/` subfolders were never recognised by the tool, leaving her with no effective way to protect her personal files in place. Her overall outcome was partial: the scraper runs cleanly, but her vault is damaged and she has no documented, safe strategy for coexisting personal and scraped files.

**06 David:** David runs frequent targeted partial syncs with `msc scrape --courses "DevOps"` to save time alongside a demanding work schedule, but immediately ran into a keyword-matching failure where a hyphenated course name did not match his intuitive keyword. He worked around it with a different substring but flagged the behaviour as a bug. When he finally investigated 45 long-accumulated orphaned state entries via `msc status --issues`, the deeply nested tree output was hard to read and `msc reset --dry-run` revealed an all-or-nothing deletion that scared him off. He found no middle-ground command to prune stale orphan entries from state while keeping his files, so he accepted the situation and continued ignoring the orphan count. He successfully used `msc config set requestDelayMs 500` to speed up partial syncs. His overall outcome was workable but friction-heavy: the targeted sync workflow functions after a workaround, the orphan debt persists indefinitely, and there is no clean path to retiring completed semesters.

**07 Sophie:** Sophie is a long-term beginner user who has been running `msc scrape` for two years without exploring any other commands. During a routine pre-deadline scrape she noticed "Orphaned: 40" for the first time, became anxious about data loss, and followed a panicked path through `msc status`, `msc status --issues`, and finally `msc reset` — believing "reset" would fix the perceived problem. She typed `y` at the confirmation prompt without fully understanding that it would permanently delete 4.2 GB of course material, including files from closed Moodle courses that could not be re-downloaded. The recovery scrape retrieved only her 8 current-semester courses; five semesters of course material was permanently lost on the eve of her bachelor thesis deadline. The core failure points were unexplained "orphaned" jargon, an insufficient `msc reset` confirmation prompt, and the absence of a state-only reset mode.

**08 Kenji:** Kenji is a developer-level user who migrated from macOS to WSL2 after one semester of successful `msc` usage on macOS. His primary blocker was the complete absence of persistent credential storage on Linux: `msc auth set` silently failed (keytar has no backend in WSL), yet printed "Credentials saved." — forcing him to re-enter credentials on every run. He successfully configured `outputDir` to a Windows-accessible `/mnt/c/...` path, but encountered friction when paths contained spaces and when `msc status --issues` output used POSIX-style paths that Windows apps could not consume directly. A 45-minute manual JSON-editing session was required to partially migrate his macOS state file, with residual path-case mismatches leaving some files showing as orphaned. His overall outcome was a working but degraded setup: scraping works, but credential re-prompting every run and manual path conversion are persistent ongoing frictions.

**09 Mira:** Mira is a Windows-native beginner installing the tool for the first time after a classmate shared the GitHub link. She hit two consecutive hard blockers: the README's non-existent npm registry package (404) and the Unix-only `sudo npm link` instruction that does not work on Windows. After help from her friend she successfully ran the first-run wizard, completed a full scrape, and got her files. On the second day she discovered credentials are not persisted between runs (Windows keytar gap), and she found `msc status` path display and TUI rendering in old CMD mildly confusing. Her overall outcome was partial success: core scrape worked but every step of the install required external help, and credential re-prompting on every run is a standing friction point.

**10 Luca:** Luca is an intermediate WSL2 user who has run the tool weekly for a year across two semesters. His main problems stem from environmental drift: a Windows reinstall left ~22 state entries pointing at old `/mnt/d/` paths, and a concurrent OneDrive sync silently caused three binary files to end up missing from disk without any scrape-time warning. He successfully used `msc clean --dry-run` to inspect his manually-added files (personal notes, summary PDFs) and the space-in-path output directory caused no issues. His key frustrations are the lack of a path-remap command for post-reinstall state migration and the inability to distinguish "Moodle-deleted orphan" from "path-drifted orphan" in `msc status` output. His overall outcome was functional but with persistent state health issues he cannot fully resolve without manually editing the JSON state file.

**11 Nele:** Nele is an intermediate macOS user who runs `msc scrape` on her Mac before study sessions and syncs the output folder to iCloud Drive for annotation on iPad in GoodNotes. The scraper works correctly for her binary download use case, but she encounters persistent friction from non-PDF output files (.md, .url.txt, .description.md) cluttering the iOS Files app. Her most serious concern is that silent overwrites of updated PDFs can silently invalidate her GoodNotes annotations without any warning, creating a data-safety risk she only discovered incidentally. She searched unsuccessfully for a `--pdf-only` flag and found no documentation targeting her iPad workflow. Her overall outcome is functional but noisy — she gets her PDFs, but the surrounding file clutter and lack of update warnings are unresolved pain points.

**12 Rafael:** Rafael is a beginner macOS user who was recommended the tool by a classmate two weeks ago and uses it solely to batch-download lecture PDFs. He successfully runs `msc scrape` weekly and retrieves the PDFs he needs, but is persistently frustrated by non-PDF output files (.md, .url.txt, .description.md) that he cannot suppress and which reappear after manual deletion. He ran `msc status` once, found the jargon-heavy output incomprehensible ("sidecar", "orphan"), and abandoned it entirely. His most damaging interaction was accidentally misusing `msc clean` — believing it would remove the MD file clutter — and confirming deletion of his own manually added files without reading the confirmation prompt carefully; there is no undo. He searched README for `--pdf-only` and `skip descriptions` without success and has resigned himself to the noise. His overall outcome is functional for the core PDF retrieval use case but leaves him confused, occasionally burned by misleading command naming, and without a path to resolve his primary friction.

**13 Hannah:** Hannah runs `msc scrape` weekly on macOS and manually copies changed `.md` files into Apple Notes for iCloud-backed study notes. She successfully reads the change report in the terminal and finds `_Beschreibungen.md` consolidation files genuinely useful. Her primary frustration is that the change report is ephemeral — closing the terminal loses the list of what changed, and neither `msc status` nor `msc status --issues` can retrieve it. She also encounters friction with Apple Notes not rendering Markdown, but accepts this as a known limitation. Her two high-severity tickets (ephemeral change report and missing `--changed` flag) converge on the same underlying gap: no persistent record of the last scrape's diff.

**14 Ben:** Ben runs `msc scrape` weekly on Mac and then reviews the change report to decide which PDFs to import into GoodNotes on his iPad, carefully importing only new (`+`) files to avoid overwriting annotated copies with blank duplicates. His workflow breaks immediately after closing the terminal — the change report is gone, and when he switches to his iPad he misremembers filenames, accidentally imports an updated PDF, and ends up with a duplicate blank copy alongside his annotated original. He finds no `msc status --changed`, no `msc log`, and no persistent change file in the output folder. All four of his tickets cluster around the same root cause (ephemeral change report) with the `_LastSync.md` proposal being the highest-impact fix, as it would sync to iCloud and be readable on iPad before any import decision is made.
