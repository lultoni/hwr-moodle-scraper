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
- **Always read source before modifying**
- **Before committing**: run the doc-updater agent (`agents/doc-updater.md`)
- **Every feature** must have a corresponding test written BEFORE the feature code
- **Agents**: each specialised task uses the matching agent instruction file in `agents/`
- **After significant changes**: commit with a contextual message

## Directory Structure
```
hwr-moodle-scraper/
├── .claude/
│   └── settings.json       # Claude Code config & hooks
├── agents/                 # Agent instruction scripts
│   ├── requirements-engineer.md
│   ├── planner.md
│   ├── test-writer.md
│   ├── developer.md
│   ├── doc-updater.md
│   └── requirements-checker.md
├── docs/
│   ├── REQUIREMENTS.md     # Full gap-free requirements
│   ├── FEATURE_TIMELINE.md # Step-by-step implementation plan
│   └── WORKFLOW.md         # Development process details
├── src/                    # Source code (created in phase 4)
├── tests/                  # Tests (created in phase 3)
├── output/                 # Scraped content (gitignored)
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

## Current Phase
**Phase 5 — Iterative Improvements — COMPLETE**
- All 22 timeline steps fully implemented with 12 comprehensive cleanup passes
- **Final status**: 240/240 tests passing (15 new tests added in cleanup passes)
- Full CLI implementation: auth, scrape, status, wizard commands
- **12 cleanup passes completed** (2026-03-27 to 2026-03-28):
  1. **Bug Fixes** — fd leak in logger, dead else-if in downloader, redirect exhaustion, migrateStatePaths not saving, 403/5xx logging
  2. **Security** — Path traversal guard in extractFilename, HTTPS check in redirects, symlink check in deleteSessionFile
  3. **Deduplication** — extractCookies→src/http/cookies.ts, getResourceId→src/scraper/resource-id.ts
  4. **Types** — migrateStatePaths returns {state, changed}, JSDoc on DownloadPlanItem.url
  5. **Code Quality** — assertedOp wrapper, progress bar closure fixed, missing file detection in status, MODULE_SEMESTER JSDoc
  6. **Tests** — checkFiles regression, dry-run describe fix, empty map test, integration localPath assertion
  7. **Documentation** — JSDoc on 4 complex functions, all 112 FEATURE_TIMELINE.md checkboxes [x], README Troubleshooting
  8. **Performance** — Memory buffer comment, activityOpenRe placement comment
  9. **Style** — UK spelling in sanitise.ts, process.stderr.write audit with justification comments
  10. **Agents** — developer.md shared utilities, html-analyzer.md label/onetopic patterns
  11. **Bug Fix** — Non-downloadable activities (assign, forum, quiz) acknowledged in state to prevent infinite re-planning
  12. **HTML Parsing & Course Formats** — balanced-div depth-counter replaces regex for altcontent, fp-filename span variant for Moodle 4.x folders, format-grid multi-page section fetching, format-onetopic multi-tab fetching, modtype CSS class as primary activity type detection, duplicate folder name deduplication in scrape.ts

## Tech Stack
Node.js 20 LTS + TypeScript 5. See `docs/TECH_STACK.md` for full decisions.
Key packages: `keytar` (Keychain), `undici` (HTTP), `commander` (CLI), `p-limit` (concurrency), `turndown` (HTML→MD).
Test runner: `vitest` with fake timers. HTTP mocking: `msw`. FS mocking: `memfs`.
