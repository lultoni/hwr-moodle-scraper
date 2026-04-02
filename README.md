# HWR Moodle Scraper

> Download all content from HWR Berlin's Moodle LMS into a structured local folder for offline study.

First run pulls everything; subsequent runs are incremental (only new or changed files).

---

## Quick Start

| Scenario | Command |
|----------|---------|
| First time setup + download everything | `msc scrape` |
| Download new / changed files only | `msc scrape` |
| Re-download everything from scratch | `msc scrape --force` |
| Re-download only files missing from disk | `msc scrape --check-files` |
| See what would be downloaded (no files written) | `msc scrape --dry-run` |
| Scrape specific courses only | `msc scrape --courses 12345,67890` |
| Override low-disk-space warning | `msc scrape --skip-disk-check` |
| See sync summary and per-course breakdown | `msc status` |
| Find missing or orphaned files | `msc status --issues` |
| Change output folder | `msc config set outputDir ~/Documents/Moodle` |
| Enable a log file | `msc config set logFile ~/moodle-scraper.log` |
| See all config values | `msc config list` |

> **Your output folder is yours** — feel free to add your own notes, highlights, and files
> alongside the downloaded content. The scraper only manages files it downloaded and will
> never delete your personal additions. `msc status` shows how many user-added files you have.

---

## Requirements

| Requirement | Notes |
|-------------|-------|
| macOS | Required — credentials are stored in the native macOS Keychain via `keytar` |
| Node.js ≥ 20 | `node --version` to check |
| Xcode Command Line Tools | Needed to compile `keytar`'s native binding: `xcode-select --install` |
| HWR Berlin Moodle account | Targets `moodle.hwr-berlin.de` specifically |

---

## Installation

```bash
# 1. Install dependencies (compiles native keytar binding)
npm install

# 2. Build TypeScript → dist/
npm run build

# 3. Link the CLI globally
npm link
```

After `npm link`, two commands are available:

| Command | Description |
|---------|-------------|
| `msc` | Short alias — use this for everyday use |
| `moodle-scraper` | Full name — same as `msc` |

> **Note:** If `msc` is already taken by another globally installed tool, `npm link` will silently overwrite it. To check first: `which msc`. If it's taken, you can still use the full `moodle-scraper` command which is less likely to conflict.

```bash
msc --version   # quick check
```

---

## Usage

### Commands

All commands are available via the short alias `msc` (or the full `moodle-scraper`):

```bash
msc scrape                       Download / sync Moodle content to local folder
msc auth set                     Store credentials in macOS Keychain
msc auth clear                   Remove stored credentials
msc auth status                  Check if credentials and session are valid
msc config get/set/list          Get, set, or list configuration
msc config reset                 Reset configuration to defaults
msc status [--issues]            Show last sync summary (with optional issue details)
msc --help                       Full help
```

### Key flags (scrape)

```
--dry-run       Show what would be downloaded without writing files
--check-files   Re-download any files missing from disk (useful if files deleted locally)
--force         Re-download everything, ignoring cached state
--quiet         Suppress all output except errors
--verbose       Debug-level output
--output <dir>  Override output directory (default: ~/moodle-scraper-output)
```

### First run

```bash
# On first run the setup wizard prompts for output directory and Moodle credentials.
# Credentials are stored in macOS Keychain — never written to disk in plaintext.
msc scrape
```

---

## Development

### Run tests

```bash
npm test                  # run all tests once
npm run test:watch        # watch mode
npm run test:coverage     # with coverage report
```

All 273 tests pass across 27 test files.

### Type-check

```bash
npm run typecheck
```

### Build

```bash
npm run build             # compiles src/ → dist/ via tsup
```

### Project structure

```
src/
├── index.ts              # CLI entry point (commander)
├── config.ts             # ConfigManager (~/.config/moodle-scraper/)
├── logger.ts             # Logger with credential redaction
├── exit-codes.ts         # Exit code constants (0–5)
├── auth/                 # Keychain, session validation, interactive prompt
├── commands/             # scrape, auth, status, wizard
├── fs/                   # Sanitise filenames, atomic writes, sidecar metadata
├── http/                 # HTTPS-only client, rate limiter, retry
├── scraper/              # Course list, content tree parsing, downloader, dispatch
└── sync/                 # State file, incremental sync plan
tests/
├── unit/                 # 27 test files (including Phase 5 fixes and regression tests)
└── integration/          # Full-scrape and incremental-sync end-to-end tests
docs/
├── REQUIREMENTS.md       # 75 gap-free requirements
├── FEATURE_TIMELINE.md   # 22-step implementation plan with traceability
├── TECH_STACK.md         # Technology decisions and rationale
└── WORKFLOW.md           # Phased development process
```

### Output folder structure

Downloaded content is organized by semester and course:

```
~/moodle-scraper-output/
├── Semester_1/
│   ├── Betriebswirtschaftliche_Grundlagen/
│   │   └── <section_name>/
│   │       └── <file>
│   └── Finanzbuchführung/
│       └── <section_name>/
│           └── <file>
├── Semester_2/
│   └── Rechnersysteme/
│       └── <section_name>/
│           └── <file>
├── Schluesselkompetenzen/
│   ├── Wissenschaftliches_Arbeiten_I/
│   └── Digitale_Kompetenzen_-_Betriebssystempraxis/
└── Sonstiges/
    └── <other_courses>/
```

State and metadata:
- `.moodle-scraper-state.json` — sync state (incrementally updated)
- `<filename>.meta.json` — metadata sidecar (only if `--metadata` flag passed)

---

## Security

- **HTTPS only** — `http://` URLs are rejected before any network call
- **Keychain storage** — credentials stored in macOS Keychain, never in config files or logs
- **Credential redaction** — all log output is scanned and secrets replaced with `[REDACTED]`
- **Atomic writes** — files written to `.tmp` first, then renamed to prevent partial downloads

---

## Troubleshooting

### `keytar` fails to compile (`Error: ENOENT: no such file or directory, spawn xcodebuild`)
Xcode Command Line Tools are required to compile `keytar`'s native macOS binding.
```bash
xcode-select --install
npm install
```

### "No courses found"
The `courseSearch` config key must be set to a keyword that matches your course names on Moodle.
```bash
msc config set courseSearch "WI"
```

### "0 files to download" on every run
All files are already up to date according to the sync state. To verify:
- `msc status` — shows last sync summary
- `msc scrape --check-files` — re-downloads any files that are missing from disk
- `msc scrape --force` — re-downloads everything regardless of state

### macOS Keychain dialog appears on first run
This is expected. macOS asks for permission the first time `msc` accesses the Keychain.
Select **Always Allow** to prevent the dialog on subsequent runs.

### Session expires during a long scrape
The scraper automatically re-authenticates using stored Keychain credentials. If re-auth fails after 3 attempts, run `msc auth set` to refresh your credentials.

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Usage / bad arguments |
| 3 | Authentication failure |
| 4 | Network error |
| 5 | Filesystem error |

---

## Tech stack

Node.js 20 LTS · TypeScript 5 (strict) · `keytar` · `undici` · `commander` · `p-limit` · `turndown` · `vitest`

See [`docs/TECH_STACK.md`](docs/TECH_STACK.md) for full decisions and rationale.
