# HWR Moodle Scraper — Advanced Usage

This document covers all commands, flags, configuration options, and output structure details.
For installation and getting started, see [README.md](README.md).

---

## All Commands

### `msc scrape`

Downloads new and changed files from Moodle.

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be downloaded without writing anything |
| `--force` | Re-download everything, ignoring cached state |
| `--check-files` | Re-download any files missing from disk (even if state says up-to-date) |
| `--courses <keywords>` | Comma-separated keywords to filter courses (fuzzy match) |
| `--course-ids <ids>` | Comma-separated numeric course IDs to scrape (exact match) |
| `--fast` | Faster scrape: shorter delays, more concurrency (heavier on the server) |
| `--no-descriptions` | Skip `.description.md` sidecars and `.url.txt` files — binaries only |
| `--output-dir <path>` | Override the output directory for this run only |
| `--json` | Output a machine-readable JSON summary to stdout |
| `--quiet` / `-q` | Suppress all output except errors |
| `--non-interactive` | Exit instead of prompting for credentials (useful in scripts) |
| `--skip-disk-check` | Skip the minimum free disk space check |

### `msc status`

Shows a summary of your downloaded files.

| Flag | Description |
|------|-------------|
| `--issues` | List old entries (ended courses) and user-added files |
| `--changed` | Show files that changed in the last scrape run |
| `--dismiss-orphans` | Remove state entries for files from ended courses |
| `--dry-run` | Preview `--dismiss-orphans` without making changes |
| `--json` | Output machine-readable JSON to stdout |

### `msc clean`

Removes files in the output folder that `msc` didn't download (personal files you added).
Shows a tree and asks for confirmation before acting.

| Flag | Description |
|------|-------------|
| `--move` | Move personal files to `User Files/` instead of deleting them |
| `--dry-run` | Show what would happen without acting |
| `--force` | Skip the confirmation prompt |

### `msc reset`

Clears sync state and optionally deletes downloaded files. Flags compose freely.

| Flag | Description |
|------|-------------|
| *(no flags)* | Clear sync state only — files on disk are untouched |
| `--state` | Same as no flags (explicit) |
| `--files` | Delete all scraper-tracked files + clear state |
| `--config` | Reset all config keys to defaults |
| `--credentials` | Clear saved Moodle credentials and session cookie |
| `--full` | Alias for `--files --config --credentials` |
| `--dry-run` | Print what would happen without making changes |
| `--move-user-files` | Interactively move personal files before deleting scraper files |
| `--force` | Skip confirmation prompt |

### `msc auth`

| Subcommand | Description |
|------------|-------------|
| `msc auth set` | Update stored Moodle credentials |
| `msc auth clear` | Remove stored credentials and session cookie |

### `msc config`

| Subcommand | Description |
|------------|-------------|
| `msc config list` | Show all config keys and their current values |
| `msc config get <key>` | Print the value of a single key |
| `msc config set <key> <value>` | Set a config key |

### `msc ignored`

Shows everything `msc` treats as invisible:
- **Section 1 — Exclude patterns:** all active glob patterns (`*` = built-in, `+` = custom from `excludePaths` config)
- **Section 2 — `_User-Files` dirs:** any directories named `_User-Files` found in the output folder
- **Section 3 — `User Files/`:** whether a `User Files/` folder (created by `msc clean --move`) exists

### `msc tui`

Opens the full-screen interactive interface. All major features are available through a keyboard-driven menu.

### `msc help [topic]`

Plain-language explanations for common concepts.

Available topics: `state`, `reset`, `clean`, `sync`, `orphaned`, `old-entries`, `user-files`, `sidecar`, `update`, `debug`, `ignored`

### `msc archive` *(experimental)*

Removes a course's state entry without touching files on disk. Use this when a course has ended and you want `msc status` to stop showing it, but you want to keep the downloaded files. The files stay exactly where they are — only the sync tracking entry is removed.

---

## Configuration

View all settings with `msc config list`, or edit interactively via `msc tui` → Config.

| Key | Default | Description |
|-----|---------|-------------|
| `outputDir` | *(set on first run)* | Folder where scraped files are saved |
| `courseSearch` | *(empty)* | Default keyword filter applied to every scrape (comma-separated) |
| `excludePaths` | *(empty)* | Glob patterns excluded from user-files detection (comma-separated) |
| `minFreeDiskMb` | `1000` | Minimum free disk space required before scraping (MB) |
| `maxConcurrentDownloads` | `3` | Number of files downloaded in parallel |
| `requestDelayMs` | `500` | Base delay between HTTP requests (ms) |
| `requestJitterMs` | `200` | Random jitter added to each request delay (ms) |
| `retryBaseDelayMs` | `5000` | Base delay for retry back-off on failed requests (ms) |
| `checkUpdates` | `true` | Check GitHub for new versions automatically |
| `updateCheckIntervalHours` | `24` | Hours between automatic update checks (`0` = every run) |
| `logFile` | `null` | Path for a persistent debug log file — always appended to (never overwritten), always at DEBUG level, captures all HTTP requests and file operations. Set to `null` to disable. |
| `displayPathFormat` | `auto` | Path separator style: `auto`, `posix`, or `windows` |
| `postScrapeHook` | `null` | Shell command to run after a scrape that produces changes (`null` = disabled) |

### Examples

```bash
# Only ever scrape courses matching "Datenbanken" or "IT-Sicherheit"
msc config set courseSearch "Datenbanken,IT-Sicherheit"

# Limit to 1 download at a time (lighter on the server)
msc config set maxConcurrentDownloads 1

# Run a custom script after every scrape that downloads something
msc config set postScrapeHook "~/scripts/sync-to-nas.sh"

# Write a full debug log to disk
msc config set logFile ~/moodle-debug.log

# Disable automatic update checks
msc config set checkUpdates false
```

---

## Personal Files

### The three mechanisms — when to use which

| Mechanism | How | Best for |
|-----------|-----|----------|
| **`_User-Files/` folder** | Create a folder named `_User-Files` anywhere in the output tree | Permanently protecting notes or personal files in a specific course folder |
| **`excludePaths` patterns** | `msc config set excludePaths "pattern/**"` | Excluding tool folders (`.obsidian/`, `my-notes/`) across many courses |
| **`User Files/` folder** | Created by `msc clean --move` | Relocating personal files out of the course tree after the fact |

### `msc clean --move` vs `msc reset --move-user-files`

Both move personal files to safety — but in different contexts:

- **`msc clean --move`** — standalone operation. Scans the output folder for personal files and moves them into `User Files/` inside the output directory. Use this anytime you want to tidy up.
- **`msc reset --move-user-files`** — protection step *before* a destructive reset. When combined with `--files`, it interactively lets you relocate personal files before `msc` deletes all its tracked files. Without this flag, any personal files mixed in with course content could be harder to find after the reset.

### `_User-Files` folders

Any directory named `_User-Files` anywhere in the output tree is completely invisible to `msc` — it never appears in `msc status`, `msc status --issues`, or `msc clean`. You create these yourself.

```
Semester_3/Datenbanken/
├── Vorlesung_1.pdf         ← managed by msc
└── _User-Files/
    ├── my-notes.md         ← invisible to msc
    └── highlighted.pdf     ← invisible to msc
```

You can place `_User-Files` at any depth — directly in `outputDir`, inside a course folder, or inside a section folder.

### `excludePaths` patterns

Built-in defaults (always active, cannot be removed): `**/.claude/**`, `**/.git/**`

Add custom patterns with:
```bash
msc config set excludePaths "my-notes/**,.obsidian/**,*.swp"
```

Or manage them interactively: `msc tui` → Config → `excludePaths`

Pattern syntax follows [picomatch glob rules](https://github.com/micromatch/picomatch#globbing-features):

| Pattern | Matches |
|---------|---------|
| `my-notes/**` | Everything inside any `my-notes/` folder |
| `.obsidian/**` | Everything inside any `.obsidian/` folder |
| `**/*.swp` | All `.swp` files anywhere in the output folder |
| `personal/**` | Everything inside a top-level `personal/` folder |

### `User Files/` folder

Created automatically by `msc clean --move`. Unlike `_User-Files`, this folder is managed by `msc clean` and lives at the root of your output directory. Safe to run repeatedly — its contents are never touched.

---

## Output Folder Structure

```
outputDir/
├── _README.md                          ← overview of the folder (updated each scrape)
├── _LastSync.md                        ← timestamp and summary of the last scrape run
├── Semester_1/
│   └── Course Name/
│       ├── _README.md                  ← course description
│       └── Section Name/
│           ├── file.pdf                ← downloaded resource
│           ├── file.description.md     ← activity description (sidecar)
│           ├── link.url.txt            ← external link as plain text
│           ├── link.webloc             ← macOS URL shortcut
│           ├── link.url                ← Windows URL shortcut
│           ├── images/                 ← embedded images from course pages
│           ├── _SectionDescription.md  ← section summary from Moodle
│           └── _Ordnerbeschreibung.md  ← folder description (if present)
├── Semester_2/ … Semester_6/
└── Sonstiges/                          ← courses not mapped to a semester
```

**Semester mapping** is based on the module code prefix in the course name (e.g. `WI2024` → Semester 1). The mapping is currently hard-coded for HWR WI module codes — courses from other cohorts or degree programmes with unknown codes land in `Sonstiges/`. Dynamic mapping is planned (see `docs/backlog.md`).

**Sidecar files** (`.description.md`) contain the activity description from Moodle, converted to Markdown. They are tracked separately and not counted in the download total.

**`_SectionDescription.md`** files contain the section summary text from Moodle. They are refreshed on every scrape run.

---

## For Developers

```bash
npm test              # run all tests (856 tests, 49 files)
npm run test:watch    # run tests in watch mode
npm run test:coverage # generate coverage report
npm run build         # compile TypeScript → dist/
npm run typecheck     # type-check without emitting
```

Architecture and development process: `docs/REQUIREMENTS.md`, `docs/FEATURE_TIMELINE.md`, `docs/WORKFLOW.md`

Agent instructions for working on this codebase: `agents/` directory
