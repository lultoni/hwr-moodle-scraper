# Development Workflow

## Phase 1 — Requirements Engineering
**Goal**: A 100% gap-free requirements document (`docs/REQUIREMENTS.md`).

**Agent**: `agents/requirements-engineer.md`
**Checker**: `agents/requirements-checker.md`

**Completeness criteria** (all must be true before advancing):
- [x] Every user interaction path is specified to its terminal state
- [x] Every error condition has a defined response
- [x] Every piece of stored data has a defined format, location, and lifecycle
- [x] No open questions remain in the document
- [x] The requirements checker agent finds zero gaps
- [x] Feature IDs are assigned to every requirement

**Output**: `docs/REQUIREMENTS.md`

---

## Phase 2 — Feature Timeline
**Goal**: A step-by-step implementation plan where every requirement ID maps to at least one timeline step.

**Agent**: `agents/planner.md`
**Checker**: `agents/requirements-checker.md` (traceability mode)

**Completeness criteria**:
- [x] Every REQ-XXX ID from REQUIREMENTS.md appears in the timeline
- [x] Each step has: ID, name, description, linked requirements, dependencies, acceptance criteria
- [x] Checker script reports 100% coverage

**Output**: `docs/FEATURE_TIMELINE.md`

---

## Phase 3 — Tests First
**Goal**: Failing tests exist for every feature before any implementation code is written.

**Agent**: `agents/test-writer.md`

**Rules**:
- Tests reference timeline step IDs
- Tests are written against the requirements, not guessed behavior
- A test must fail (or be skipped) before the feature is implemented

**Output**: `tests/` directory

**Checklist**:
- [x] All 22 timeline steps have corresponding test files
- [x] All tests written to spec; green tests skipped until implementation phase

---

## Phase 4 — Implementation
**Goal**: Make all tests pass.

**Agent**: `agents/developer.md`

**Rules**:
- Implement one timeline step at a time
- After each step: run tests, only advance if passing
- No new features without a corresponding test

**Output**: `src/` directory

**Checklist**:
- [x] All 22 steps implemented
- [x] All 377 tests passing (33 test files)
- [x] Full CLI with auth, scrape, status, wizard, reset, tui commands
- [x] Security: keychain integration, credential handling, HTTPS + retry logic
- [x] Sync: rate limiting, incremental updates, state management
- [x] Phase 5 improvements: 22 cleanup/enhancement passes completed

---

## Phase 5 — Iterative Improvements (ongoing)
**Workflow**:
1. User provides feedback or reports a scraping quality issue
2. Follow `agents/debug-workflow.md` if it's a parsing/scraping bug (capture HTML → write test → fix → verify)
3. For new features: test writer updates/adds tests; developer implements; doc-updater runs before commit
4. Run `npx vitest run` — all tests must pass before committing
5. Run `node scripts/file-checker.js` — must exit 0 before ending the session

**Current status**: 22 cleanup passes completed (2026-03-27 to 2026-04-02). 377/377 tests passing. See `docs/FEATURE_TIMELINE.md` and `CLAUDE.md` for full history.

---

## Commit Strategy
- Commit after each phase completion
- Commit after each meaningful timeline step
- Message format: `<phase>(<scope>): <what changed and why>`
- Before every commit: run `agents/doc-updater.md`
