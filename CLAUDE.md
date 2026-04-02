# HWR Moodle Scraper — CLAUDE.md

## Project Overview
A CLI-based web scraper that pulls all content from HWR Berlin's Moodle LMS into a structured local folder. First run pulls everything; subsequent runs are incremental (only changed/new content).

## Development Workflow
Follow the phases in `docs/WORKFLOW.md` strictly:
1. Requirements (docs/REQUIREMENTS.md) — must be gap-free before moving on
2. Feature Timeline (docs/FEATURE_TIMELINE.md) — every requirement must be traceable
3. Tests first (tests/ directory) — write tests before implementing features
4. Implementation
5. Iterative feedback incorporation

## Mottos (priority order)
1. **Security first** — credentials never in logs, no hardcoded secrets, HTTPS only, secure credential storage
2. **Clean code second** — readable, minimal, well-structured
3. **Usability third** — intuitive CLI UX

## Key Rules
- **Never commit credentials or secrets**
- **Always read source before modifying** — never modify a file you have not fully read
- **Tests before features** — write or update the test first; the test must fail before the implementation exists
- **After significant changes**: run `npx vitest run` — all 377 tests must pass; commit with a contextual message
- **Run file-checker before ending any session**: `node scripts/file-checker.js` must exit 0

## Critical Parsing Patterns — Do Not Regress

These patterns were hard-won through real HTML debugging. Do not simplify or replace them.

### Balanced-div depth counter
Used in three places: `parseActivityFromElement` (activity-altcontent), `extractCourseDescription`, `parseContentTree` (summarytext). A non-greedy regex `[\s\S]*?` stops at the first `</div>` — truncating nested content. The depth counter walks every `<div` (+1) and `</div` (-1) to find the matching closing tag. **Never replace with a regex.**

### extractPageContent (forum.ts)
Called before every Turndown HTML→MD conversion for page-md and forum thread pages. Without it, Turndown converts the full 200 KB Moodle page (nav, scripts, sidebars) into noise. Tries `<div role="main">`, `<div id="page-content">`, `<div id="region-main">` in order. **Never pass raw page HTML to Turndown.**

### Section summaries (_Abschnittsbeschreibung.md)
`Section.summary` is populated from `<div class="summarytext">` in `parseContentTree`. Written to `_Abschnittsbeschreibung.md` in the section dir by `runScrape`. These files are **outside sync-state** (no FileState entry, refreshed every run). Do not add them to the download plan or they will appear as user-added files in `msc status` and be deleted by `msc reset`.

### isSidecar flag (description-md strategy)
`description-md` items generate `.description.md` sidecar files alongside the main activity file. They are tagged `isSidecar: true` in `specialItems` and tracked via `FileState.sidecarPath`. They are excluded from `downloadedCount`, `totalItems` counter, and the progress bar total, but shown separately in the "Done:" summary line. Do not merge them into `downloadedCount`.

### extractCourseDescription candidates
Three CSS class variants are tried in order: `\bsummary\b`, `course-summary-section`, `summarytext`. Note: `\bsummary\b` does NOT match `summarytext` (word boundary fails). All three are needed — different Moodle theme variants use different class names.

### data-activityname (primary name source)
`parseActivityFromElement` uses `data-activityname` as the **primary** activity name source, falling back to link text only if absent. This prevents cross-reference links inside `<li>` elements (e.g. customcert linking to its paired scorm) from polluting activity names. Do not change the priority order.

### Course name construction (shortname + fullname)
`fetchEnrolledCourses` sets `courseName = shortname !== fullname ? \`${shortname} ${fullname}\` : fullname`. The shortname contains the WI#### module code needed by `parseCourseNameParts` for semester mapping. If shortname === fullname (e.g. "Bibliothek benutzen"), only one copy is used to prevent doubled folder names.

## Directory Structure
```
hwr-moodle-scraper/
├── .claude/
│   └── settings.json       # Claude Code config & hooks
├── agents/                 # Agent instruction scripts
├── docs/
│   ├── REQUIREMENTS.md     # Full gap-free requirements
│   ├── FEATURE_TIMELINE.md # Step-by-step implementation plan
│   └── WORKFLOW.md         # Development process details
├── src/                    # Source code
├── tests/                  # Tests
├── debug/                  # Gitignored — HTML captures for debugging; clean after each session
├── CLAUDE.md               # This file
└── README.md
```

## Agent Usage
| Task | Agent |
|------|-------|
| Elicit / refine requirements | `agents/requirements-engineer.md` |
| Check requirements completeness | `agents/requirements-checker.md` |
| Create feature timeline | `agents/planner.md` |
| Write tests | `agents/test-writer.md` |
| Write implementation code | `agents/developer.md` |
| Update docs before commit | `agents/doc-updater.md` |
| Analyze HTML parsing issues | `agents/html-analyzer.md` |
| Debug scraping errors / file anomalies | `agents/debug-workflow.md` |

## Debug Workflow
When a user reports broken files or before ending a session:
1. Follow `agents/debug-workflow.md` — capture HTML in `debug/` (gitignored), locate bug, write test, fix, re-scrape
2. Run `node scripts/file-checker.js` — must exit 0 before session ends (also runs automatically via Stop hook)
3. Clean `debug/` after file-checker passes

## Current Phase
**Phase 5 — Iterative Improvements (ongoing)**
- All 22 timeline steps fully implemented; 377/377 tests passing (32 test files)
- Full CLI: auth, scrape, status, wizard, reset, tui + first-run wizard
- 22 cleanup/improvement passes completed (see `docs/FEATURE_TIMELINE.md` for full history)

## Tech Stack
Node.js 20 LTS + TypeScript 5. See `docs/TECH_STACK.md` for full decisions.
Key packages: `keytar` (Keychain), `undici` (HTTP), `commander` (CLI), `p-limit` (concurrency), `turndown` (HTML→MD).
Test runner: `vitest` (`npx vitest run`). HTTP mocking: `undici MockAgent`. FS mocking: `memfs`.
