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
- [ ] The requirements checker agent finds zero gaps
- [ ] Feature IDs are assigned to every requirement

**Output**: `docs/REQUIREMENTS.md`

---

## Phase 2 — Feature Timeline
**Goal**: A step-by-step implementation plan where every requirement ID maps to at least one timeline step.

**Agent**: `agents/planner.md`
**Checker**: `agents/requirements-checker.md` (traceability mode)

**Completeness criteria**:
- [ ] Every REQ-XXX ID from REQUIREMENTS.md appears in the timeline
- [ ] Each step has: ID, name, description, linked requirements, dependencies, acceptance criteria
- [ ] Checker script reports 100% coverage

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

---

## Phase 4 — Implementation
**Goal**: Make all tests pass.

**Agent**: `agents/developer.md`

**Rules**:
- Implement one timeline step at a time
- After each step: run tests, only advance if passing
- No new features without a corresponding test

**Output**: `src/` directory

---

## Phase 5 — Iterative Improvements
**Workflow**:
1. User provides feedback
2. Feedback agent updates REQUIREMENTS.md and/or FEATURE_TIMELINE.md
3. Test writer updates/adds tests for changed requirements
4. Developer implements changes
5. Doc updater runs before commit

---

## Commit Strategy
- Commit after each phase completion
- Commit after each meaningful timeline step
- Message format: `<phase>(<scope>): <what changed and why>`
- Before every commit: run `agents/doc-updater.md`
