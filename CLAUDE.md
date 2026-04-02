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
│   ├── requirements-checker.md
│   ├── html-analyzer.md
│   └── debug-workflow.md
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
| Analyze HTML parsing issues | `agents/html-analyzer.md` |
| Debug scraping errors / file anomalies | `agents/debug-workflow.md` |

## Debug Workflow
When a user reports broken files or before ending a session:
1. Follow `agents/debug-workflow.md` — capture HTML in `debug/` (gitignored), locate bug, write test, fix, re-scrape
2. Run `node scripts/file-checker.js` — must exit 0 before session ends (also runs automatically via Stop hook)
3. Clean `debug/` after file-checker passes

## Current Phase
**Phase 5 — Iterative Improvements — COMPLETE**
- All 22 timeline steps fully implemented with 20 comprehensive cleanup passes
- **Final status**: 365/365 tests passing across 32 test files
- Full CLI implementation: auth, scrape, status, wizard, reset, tui commands with first-run wizard
- **20 cleanup/improvement passes completed** (2026-03-27 to 2026-04-02):
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
  13. **Save-What-You-Can** — Replaced SKIP_TYPES silent-skip with `page-md` (forum/quiz/glossary/book/lesson/wiki/workshop) and `info-md` (assign/feedback/choice/vimp/hvp/scorm/flashcard/survey/chat/lti/imscp/grouptool/bigbluebuttonbn) strategies; zero information loss
  14. **UX Polish & First-Run Wizard** — First-run wizard (skPlacement, skSemester, logFile), config defaults (outputDir guard, minFreeDiskMb=1000, logHintShown), scrape output (disk check with --skip-disk-check, phase headers, per-course ✓ lines, one-time log hint), status rewrite (per-course table, disk sizes, user-file detection, --issues tree views), README Quick Start table with 12 scenarios + "your folder is yours" note
  15. **Reset Bug Fixes** — `sidecarPath` field in FileState so `.description.md` sidecars are tracked and deleted by `msc reset`; inline removeEmptyDirs replaced with recursive version from state.ts; `--dry-run` output rewritten as tree with box-drawing chars (relative paths)
  16. **Course Listing + Timestamps + SHA-256** — `parseCourseSearchHtml` two-step rewrite (data-courseid scan + forward slice search) + `&perpage=200` for all 38+ courses; `timestamps` option in logger (false=terminal clean, true=logFile); SHA-256 content hash in `atomicWrite`→`downloader`→`scrape`→`incremental` (hash comparison under `--check-files`)
  17. **Iframe-Embed Fix + Richer Moodle Content** — `downloadFile` detects Moodle "display in frame" HTML pages and follows embedded pluginfile.php link; course `README.md` from summary; forum threads deep-dive (all discussions); assignment feedback + grade + own submission download; file-checker hook now exit-2 blocking
  18. **TUI + User-Files-Move** — `msc tui` command: full interactive terminal UI with arrow-key navigation (built-in readline/tty, zero new deps); screens for Scrape, Status, Reset, Auth, Config; `src/tui/keys.ts` (raw-mode keyboard), `src/tui/select.ts` (arrow-key selector, non-TTY promptFn fallback), `src/tui/menu.ts` (box-drawing main menu), `src/tui/screens/`; `msc reset --move-user-files` flag: detects user-owned files, groups by top-level dir, interactively asks per group (output-root / parent / custom / skip); `src/fs/collect.ts` extracted from status.ts (`collectFiles` + `groupUserFiles`)
  19. **TUI + SK Refinements** — SK folder structure fixed: `detectSkSemester()` returns plain `"Semester_N"`, new `isSkCourse()` helper detects WI6xxx and MSK/SK prefix courses, `parseCourseNameParts()` prefixes `SK_` on shortName for SK courses; dead code removed (`skPlacement`, `skSemester` defaults, `resolveSemesterDir()`); full-screen TUI: `menu.ts` uses full clear (`\u001b[2J\u001b[H`), cursor management (`\u001b[?25l`/`\u001b[?25h`), `keys.ts` cursor restoration before exit; two-step scrape flow (mode selector → options sub-menu with `[x]` toggles); status screen selector (Summary vs Issues)
  20. **HWR Courses AJAX + stderr Silencing** — Courses bug fix: HWR Berlin's Moodle uses AJAX-rendered `block_myoverview` (courses not in static HTML); fixed `src/scraper/courses.ts` to: (1) fetch `/my/` for fresh `sesskey` from inline JS config, (2) POST to `/lib/ajax/service.php` with `core_course_get_enrolled_courses_by_timeline_classification` to get all 42 enrolled courses as JSON, (3) fallback to old `/my/courses.php` HTML parser for compatibility. TUI exit: removed "Goodbye." message (silent exit via q/Escape). Stderr fix: added `{ stdio: "pipe" }` to `execSync` in `src/fs/output.ts` so `df` errors when outputDir doesn't exist are silently swallowed instead of polluting terminal. Tests: rewritten 6 broken course-listing tests to mock new AJAX flow, added 42-course regression test.

## Tech Stack
Node.js 20 LTS + TypeScript 5. See `docs/TECH_STACK.md` for full decisions.
Key packages: `keytar` (Keychain), `undici` (HTTP), `commander` (CLI), `p-limit` (concurrency), `turndown` (HTML→MD).
Test runner: `vitest` with fake timers. HTTP mocking: `msw`. FS mocking: `memfs`.
