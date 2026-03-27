# HWR Moodle Scraper

> Download all content from HWR Berlin's Moodle LMS into a structured local folder for offline study.

First run pulls everything; subsequent runs are incremental (only new or changed files).

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

After `npm link`, two commands are available: `moodle-scraper` and the shorthand `msc`.

```bash
moodle-scraper --version
```

---

## Usage

### Commands

```bash
moodle-scraper scrape                Download / sync Moodle content to local folder
moodle-scraper auth set              Store credentials in macOS Keychain
moodle-scraper auth clear            Remove stored credentials
moodle-scraper auth status           Check if credentials and session are valid
moodle-scraper config get/set/list   Get, set, or list configuration
moodle-scraper config reset          Reset configuration to defaults
moodle-scraper status [--issues]     Show last sync summary (with optional issue details)
moodle-scraper --help                Full help
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
moodle-scraper scrape
```

---

## Development

### Run tests

```bash
npm test                  # run all tests once
npm run test:watch        # watch mode
npm run test:coverage     # with coverage report
```

All 224 tests pass across 27 test files.

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
