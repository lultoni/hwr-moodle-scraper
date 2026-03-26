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
**Phase 3 — Tests First**
- 75 requirements across 7 categories (REQ-AUTH, REQ-SCRAPE, REQ-SYNC, REQ-FS, REQ-CLI, REQ-SEC, REQ-ERR)
- Feature Timeline complete: 22 steps in `docs/FEATURE_TIMELINE.md`, traceability audit PASS (75/75)
- Next: write failing tests for each STEP before any implementation code

## Tech Stack
Node.js 20 LTS + TypeScript 5. See `docs/TECH_STACK.md` for full decisions.
Key packages: `keytar` (Keychain), `undici` (HTTP), `commander` (CLI), `p-limit` (concurrency), `turndown` (HTML→MD).
Test runner: `vitest` with fake timers. HTTP mocking: `msw`. FS mocking: `memfs`.
