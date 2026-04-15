## Role
WSL2 power user with a complicated output path — manages cross-semester orphans and cross-environment path drift.

## Profile

- **Semester**: 5th
- **Major**: Wirtschaftsinformatik (WI)
- **OS**: Windows 11 with WSL2 (Ubuntu 22.04); runs all Node.js tooling inside WSL2
- **Tech level**: Intermediate — comfortable in bash, understands npm, has used git; does not deeply understand Node.js internals
- **Moodle courses**: 17 enrolled
- **Usage history**: 1 year (installed at the start of semester 4; now in semester 5)
- **Long-term state**: 2 completed semesters of orphaned files (~22 entries); output directory is at `/mnt/c/Users/Luca/Documents/Moodle Scraper Output` (path contains a space); state file intact but some state `localPath` entries carry the old WSL mount path from before a Windows reinstall (`/mnt/d/...` instead of `/mnt/c/...`)
- **Use pattern**: Runs `msc scrape` weekly on Sunday evening; checks `msc status` roughly once a month; OneDrive syncs the output folder to cloud automatically
- **Motivations**: Organized offline study archive; OneDrive sync means files are available on his Windows desktop and phone; wants a clean, tidy folder structure without stale content
- **Frustrations pre-tool**: Manually downloading slides every week was tedious; forgetting to download before an offline train journey; no version history for updated lecture materials

## Workflow Trace

1. **Runs `msc scrape`** — the output dir path `/mnt/c/Users/Luca/Documents/Moodle Scraper Output` (with a space) is stored in config. The scrape runs without error; the space in the path is handled correctly by Node.js `fs` calls. Files download fine.

2. **OneDrive is open in the background syncing files** — during the scrape, OneDrive locks a partially-synced `.pdf` file as it uploads it. The scraper's `atomicWrite` renames a `.tmp` file to the final destination. OneDrive has a transient file lock on the destination. The rename fails with `EPERM`. The file ends up partially downloaded (only the `.tmp` exists, final path is missing). The scrape reports it as complete with no error because the exception is swallowed in some edge case.

3. **Runs `msc status`** — sees 22 orphaned state entries from semesters 3 and 4. He also notices 3 entries that look like they should exist but are listed as missing. Those are the OneDrive-locked files from step 2.

4. **Tries to understand which orphans are "Moodle deleted it" vs "path changed after Windows reinstall"** — `msc status` shows all orphans uniformly; there is no metadata on why a file became orphaned (path mismatch vs resource deleted from Moodle).

5. **Runs `msc config get outputDir`** — sees `/mnt/c/Users/Luca/Documents/Moodle Scraper Output` with the space. Confirms the current path is correct. But some state entries still reference `/mnt/d/...` paths from before the reinstall.

6. **Runs `msc clean --dry-run`** — lists a handful of files he added manually to the output folder (personal notes, a custom summary PDF). Output is clear and correct. He is satisfied.

7. **Runs `msc scrape --check-files`** to catch the 3 missing files from the OneDrive lock event — the flag re-checks disk presence and queues re-downloads. The 3 files re-download. Good.

8. **Runs `msc status --issues`** — the old `/mnt/d/...` state entries are now surfaced as "missing files" because the paths don't exist on disk. He cannot easily tell if these are "path-drifted" entries from the reinstall or genuinely missing downloads. He wants a way to remap or bulk-clear stale path-prefix entries.

9. **Wishes he could run `msc config set outputDir /new/path` and have the scraper update all state `localPath` entries accordingly** — no such migration command exists.

## Gap & Friction Log

| # | Step | Issue | Severity | Type |
|---|------|-------|----------|------|
| 1 | Scrape | OneDrive (or any cloud sync client) can hold a transient file lock on a destination file during `atomicWrite` rename, causing `EPERM`; error may be silently swallowed leaving a missing file with no warning | High | Bug / Reliability |
| 2 | Status | `msc status` orphan list does not distinguish "Moodle resource deleted" from "local path changed / no longer exists" — both show as orphaned | Medium | UX |
| 3 | State migration | After a Windows reinstall, state `localPath` entries reference the old drive mount path; no command to remap a path prefix across all state entries | High | Feature gap |
| 4 | Status | `msc status --issues` missing-file entries don't indicate whether the file was ever successfully downloaded (could be a path-drift or a failed download) | Medium | UX |
| 5 | Config | No `msc config migrate-paths` or `msc state remap` command to bulk-update `outputDir` and all associated state `localPath` entries when the output folder moves | High | Feature gap |

## Feature Requests & Findings

**TICKET-1**
- **Type**: Bug / Reliability
- **Persona**: Luca (persona-10)
- **Severity**: High
- **Description**: When a cloud sync client (OneDrive, Dropbox, iCloud Drive) holds a transient file lock on a download destination during `atomicWrite`, the `fs.rename` from `.tmp` to final path fails with `EPERM`. If this error is not surfaced clearly, the file is silently missing from disk while state records it as downloaded. `--check-files` re-downloads it, but the user may not know to run it.
- **Proposed resolution**: In `atomicWrite`, catch `EPERM`/`EBUSY` rename errors and (a) log a clear warning naming the affected file, (b) add the file to a "failed" list that is printed in the scrape summary and marked in state as `status: "error"` so `msc status --issues` surfaces it immediately without needing `--check-files`.
- **Affected commands/flows**: `msc scrape`, `atomicWrite` in `src/fs/output.ts`, `msc status --issues`

**TICKET-2**
- **Type**: UX improvement
- **Persona**: Luca (persona-10)
- **Severity**: Medium
- **Description**: `msc status` displays all orphaned state entries uniformly. There is no way to tell whether an orphan exists because (a) the Moodle resource was deleted/moved on the server, (b) the file was never successfully downloaded, or (c) the local path changed (drive letter, mount point, or folder rename). These three causes require different user actions.
- **Proposed resolution**: Add an optional `orphanReason` field to `FileState` (values: `"moodle-removed"`, `"never-downloaded"`, `"path-missing"`). Populate `"path-missing"` when a state entry's `localPath` does not exist on disk but the Moodle resource still exists in the content tree. Populate `"moodle-removed"` during sync plan reconciliation. Display the reason in `msc status` output.
- **Affected commands/flows**: `msc status`, `msc status --issues`, sync plan in `src/sync/`

**TICKET-3**
- **Type**: Feature gap
- **Persona**: Luca (persona-10)
- **Severity**: High
- **Description**: After moving the output folder (or after a Windows reinstall changes the drive mount path), all state `localPath` entries reference the old path prefix. There is no command to remap a path prefix across all state entries. The user must either do a full reset (losing all state) or manually edit the JSON state file.
- **Proposed resolution**: Add `msc config set-output-dir <newPath>` (or `msc state remap-paths --from <old> --to <new>`) that: (1) updates `outputDir` in config, (2) rewrites every `localPath`, `sidecarPath`, and `imagePaths` entry in state by replacing the old path prefix with the new one, (3) prints a summary of how many entries were updated, (4) supports `--dry-run`.
- **Affected commands/flows**: `msc config`, new command `msc state remap-paths`

**TICKET-4**
- **Type**: UX improvement
- **Persona**: Luca (persona-10)
- **Severity**: Medium
- **Description**: `msc status --issues` lists "missing files" (state entries whose `localPath` does not exist on disk) but does not indicate whether the file was previously successfully downloaded or was always missing. A successfully-downloaded file that disappeared (path drift, accidental deletion) looks identical to a file that failed during download and was never written.
- **Proposed resolution**: Add a `downloadedAt` timestamp or a `everDownloaded: boolean` field to `FileState`. Use this in `msc status --issues` to annotate missing files: "previously downloaded, now missing" vs "never successfully downloaded".
- **Affected commands/flows**: `msc status --issues`, `FileState` in `src/sync/state.ts`
