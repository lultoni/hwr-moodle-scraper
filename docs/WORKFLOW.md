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
- [x] All 784 tests passing (48 test files)
- [x] Full CLI with auth, scrape, status, wizard, reset, tui, clean, help, archive commands
- [x] Security: keychain integration, credential handling, HTTPS + retry logic, password env vars on non-macOS
- [x] Sync: rate limiting, incremental updates, state management, orphan dismissal, last-sync tracking
- [x] Phase 5 improvements: 43 cleanup/enhancement passes completed

---

## Phase 5 — Iterative Improvements (ongoing)
**Workflow**:
1. User provides feedback or reports a scraping quality issue
2. Follow `agents/debug-workflow.md` if it's a parsing/scraping bug (capture HTML → write test → fix → verify)
3. For new features: use `EnterPlanMode`, surface design decisions via `AskUserQuestion`, then: write tests → implement → `npx vitest run` → `node scripts/file-checker.js` → commit per feature
4. At end of pass: bump version if user-facing features were added (see versioning below), update CLAUDE.md, rebuild: `npm run build && npm install -g .`

**Current status**: 43 cleanup/improvement passes completed. 784/784 tests passing (48 test files). Version: `0.6.0`.

---

## Versioning

`MAJOR.MINOR.PATCH` (pre-1.0: `0.MINOR.PATCH`):
- **MINOR** (`0.x.0`) — user-facing features added (new commands, flags, UX changes, new user-visible config keys)
- **PATCH** (`0.0.x`) — bug fixes, refactors, test/doc-only changes
- After bumping `package.json`: `npm run build && npm install -g .`

---

## Commit Strategy
- Commit after each phase completion
- Commit after each meaningful timeline step
- Message format: `<phase>(<scope>): <what changed and why>`
- Before every commit: run `agents/doc-updater.md`
