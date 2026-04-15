# Persona Template

## How to use this template

Copy this file to `persona-NN-name.md`. Fill every section. Do not leave placeholder text in the finished file. Each persona file is self-contained — no shared state with other personas.

Persona files serve two purposes:
1. **Human reference** — communicate who uses the tool and what frustrates them.
2. **Agent input** — the coordinator agent (`coordinator.md`) reads them to drive a simulated workflow sweep and produce `docs/persona-findings.md`.

---

## Role

One paragraph. Who is this person? Semester, programme, technical background, OS, what they want from the tool. Written in third person. Concrete and specific — no generalities like "typical student".

Example: "Lea is a first-semester Wirtschaftsinformatik student at HWR Berlin. She uses macOS and has never opened a terminal before today. She installed the tool after a classmate showed her the README. She wants offline PDF copies of her lecture slides so she can study on the S-Bahn."

---

## Profile

| Field | Value |
|-------|-------|
| Name | <!-- First name only --> |
| Semester | <!-- e.g. 1st semester WI --> |
| OS | <!-- macOS / Ubuntu 22.04 / Windows 11 --> |
| Tech level | <!-- beginner / intermediate / advanced --> |
| Enrolled courses | <!-- count --> |
| Usage history | <!-- first install today / 3 months / 2 semesters --> |
| State file condition | <!-- clean / has orphans / has user-added files / corrupt --> |
| Keychain available | <!-- yes (macOS) / no (Linux) / no (Windows) --> |
| Primary motivation | <!-- one sentence --> |
| Main frustration | <!-- one sentence --> |

---

## Workflow Trace

Numbered steps. Each step covers: what the persona tries, what command they run (if any), what they see in the terminal, and their reaction. Write in third person, present tense.

Use code blocks for commands and terminal output excerpts. Mark observed output with `>` prefix.

Steps should be realistic — include wrong commands, confusion, re-tries. Do not show a perfect happy path unless the persona is explicitly advanced.

Format each step as:

**N. [Action title]**
What they try and why. What they type. What they see. How they react.

```
$ command they run
> output they see
```

Reaction / next step decision.

---

## Gap & Friction Log

Table of observed friction points. One row per distinct issue. Be specific — reference the step number where it appeared.

| # | Step | Area | Observation | Severity |
|---|------|------|-------------|----------|
| 1 | <!-- step number --> | <!-- auth / scrape / status / tui / output / install --> | <!-- what the gap is --> | <!-- high / medium / low --> |

Severity scale:
- **high** — blocks the persona from completing their goal entirely
- **medium** — causes confusion or requires workaround but goal is achievable
- **low** — minor annoyance, no functional impact

---

## Feature Requests & Findings

One TICKET entry per distinct issue. Tickets are deduplicated across personas by the coordinator — use the same TICKET ID if the same issue appears in multiple personas.

Format each ticket as:

### TICKET-N: [Short title]

| Field | Value |
|-------|-------|
| Type | bug / ux / feature / docs |
| Severity | high / medium / low |
| Affected command | <!-- e.g. `msc scrape`, `msc status`, install, output-files --> |
| Persona(s) | <!-- e.g. persona-01-lea --> |
| Gap reference | <!-- Gap # from the table above --> |

**Description:** One or two sentences describing the problem precisely.

**Proposed fix:** Concrete, actionable suggestion. Reference a specific file or command if possible. If no fix is obvious, write "Needs design decision."
