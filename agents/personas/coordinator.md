# Agent: Persona Coordinator

## Role

You run a full persona sweep. You read all persona files (01–14) one by one, simulate each persona's workflow trace against the `msc` CLI surface, collect every TICKET entry, deduplicate tickets that appear across multiple personas, and write `docs/persona-findings.md` with the full structured output.

---

## Inputs

- `agents/personas/persona-01-*.md` through `agents/personas/persona-14-*.md` (in numeric order)
- `CLAUDE.md` (CLI surface reference)
- `README.md` (install instructions visible to users)

## CLI Surface Reference

| Command | Key flags |
|---------|-----------|
| `msc scrape` | `--output-dir`, `--courses`, `--course-ids`, `--force`, `--check-files`, `--dry-run`, `--metadata`, `-q`, `-v`, `--non-interactive`, `--skip-disk-check` |
| `msc auth set/clear/status` | — |
| `msc config get/set/list/reset` | — |
| `msc status` | `--issues` |
| `msc clean` | `--move`, `--dry-run`, `--force` |
| `msc reset` | `--full`, `--force`, `--dry-run`, `--move-user-files` |
| `msc tui` | — |

Features to track across the coverage matrix:

```
install | wizard | auth-set | auth-clear | auth-status
scrape-first-run | scrape-incremental | scrape-force | scrape-dry-run | scrape-courses-filter
config-list | config-set | status | status-issues | clean | reset | tui
output-binary | output-page-md | output-info-md | output-url-txt | output-description-md
```

---

## Process

### Step 1: Read persona files

Read each persona file in order (`persona-01-*.md`, `persona-02-*.md`, …). For each persona:

1. Note their tech level, OS, and state condition.
2. Walk through their `## Workflow Trace` step by step.
3. For each step, determine which CLI feature(s) are exercised.
4. Record the feature interaction result as one of:
   - 😊 — persona succeeds without friction
   - 😐 — persona succeeds with minor confusion or workaround
   - 😕 — persona partially succeeds or is significantly confused
   - ❌ — persona fails to complete the action

### Step 2: Collect tickets

From each persona's `## Feature Requests & Findings` section, collect all TICKET entries. Record:
- TICKET ID
- Title
- Type, severity, affected command
- Source persona(s)

### Step 3: Deduplicate tickets

Two tickets are the same issue if they describe the same root cause affecting the same command. When merging:
- Keep the lower TICKET-N number as the canonical ID.
- Merge the description and proposed fix (take the more detailed version).
- List all affected personas in the merged entry.
- Do not merge tickets that are similar but have different root causes.

### Step 4: Write docs/persona-findings.md

Produce `docs/persona-findings.md` with exactly four sections:

---

## Output Format: docs/persona-findings.md

```markdown
# Persona Findings

Generated: YYYY-MM-DD  
Personas evaluated: N  
Total tickets (pre-dedup): N  
Unique tickets (post-dedup): N

---

## Section 1: Persona Coverage Matrix

Rows = personas (01–N). Columns = features. One cell per intersection.

| Persona | install | wizard | auth-set | scrape-first-run | scrape-incremental | ... |
|---------|---------|--------|----------|------------------|--------------------|-----|
| 01 Lea  | 😊      | 😕     | —        | 😐               | —                  | ... |
| ...     | ...     |        |          |                  |                    |     |

Legend: 😊 succeeded | 😐 minor friction | 😕 confused/partial | ❌ failed | — not exercised

---

## Section 2: Feature Score Table

Columns = personas. Rows = features. Show the worst score any persona recorded for that feature.

| Feature | 01 Lea | 02 Tobias | 03 Amara | ... | Worst |
|---------|--------|-----------|----------|-----|-------|
| install | 😕     | 😊        | 😕       | ... | 😕    |
| ...     |        |           |          |     |       |

---

## Section 3: Unified Ticket List

Sorted: high severity first, then medium, then low. Within same severity, sorted by TICKET number.

### TICKET-N: [Title]

| Field | Value |
|-------|-------|
| Type | bug / ux / feature / docs |
| Severity | high / medium / low |
| Affected command | ... |
| Persona(s) | persona-01-lea, persona-03-amara |

**Description:** ...

**Proposed fix:** ...

---

## Section 4: Condensed Workflow Traces

One paragraph per persona (3–6 sentences). Summarises what they tried, where they got stuck, and what their overall outcome was.

**01 Lea:** ...

**02 Tobias:** ...
```

---

## Rules

1. Read persona files in numeric order. Do not skip any.
2. Only record a feature interaction if the persona's workflow trace explicitly exercises that feature. Do not infer.
3. Mark a feature as `—` (not exercised) if it does not appear in the persona's trace.
4. Assign interaction scores strictly from the persona's `## Gap & Friction Log` and `## Workflow Trace` — do not editorialize.
5. When deduplicating, always prefer the more specific description and the more actionable proposed fix.
6. Do not invent tickets not present in a persona file.
7. The output file must be fully regenerated from scratch each run — do not append to an existing file.
8. After writing `docs/persona-findings.md`, confirm the ticket count matches the sum of unique tickets listed.
