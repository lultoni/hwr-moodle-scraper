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
**Phase 5 — Iterative Improvements**
- All 22 timeline steps implemented + Phase 5 fixes; 224/224 tests passing across 27 test files
- Full CLI implementation: auth, scrape, status, wizard commands
- **Phase 5 fixes applied** (2026-03-27+):
  - Fixed redirect handling in `fetchContentTree` and `downloadFile` (root cause of "0 to download")
  - Fixed activity name pollution from `<span class="accesshide">` text leaking into names
  - Added all modtypes: `folder`, `page`, `label`, `quiz`, `glossary`, `grouptool`, `bigbluebuttonbn`
  - Implemented folder expansion (`fetchFolderFiles`) — enumerates files inside Moodle folders
  - Added `src/scraper/dispatch.ts` — type-aware download strategy (binary/url-txt/page-md)
  - Added `agents/html-analyzer.md` — agent for analyzing Moodle HTML structure
  - Added per-course debug logging in scrape command
  - Progress bar fixes: added `onComplete` callback to `DownloadFileOptions` and `DownloadItem` for accurate incremental progress tracking
  - Onetopic section names: `parseOnetopicTabs(html)` builds sectionNumber→name map from tab nav, used as 3rd fallback in `parseContentTree`
  - Label content + activity descriptions: extract `activity-altcontent` to `Activity.description`, produce `label-md` items and `description-md` sidecars with HTML-to-Markdown conversion
  - Added `--check-files` flag: re-downloads missing local files without requiring `--force`
  - **Semester grouping + state migration**: reorganized output to `<outputDir>/Semester_X/CourseName/SectionName/` for better structure; `migrateStatePaths()` silently updates old state file paths on first run with new structure
  - Fixed state save bug: wrapped `binaryItems` as `{ downloadItem, planItem }` pairs to eliminate off-by-one indexing error

## Tech Stack
Node.js 20 LTS + TypeScript 5. See `docs/TECH_STACK.md` for full decisions.
Key packages: `keytar` (Keychain), `undici` (HTTP), `commander` (CLI), `p-limit` (concurrency), `turndown` (HTML→MD).
Test runner: `vitest` with fake timers. HTTP mocking: `msw`. FS mocking: `memfs`.
