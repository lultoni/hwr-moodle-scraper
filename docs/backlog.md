# Backlog

Items listed here are planned improvements, not yet implemented.
Format: `[ ]` open, `[x]` done, `[-]` dropped.

---

## Features

### [x] `msc help` in TUI
**Priority:** Low
Done in Pass 55 (v0.9.2): "Help" menu entry added to `msc tui`, opens topic picker.
Two new help topics added: `archive`, `config`. Existing topics expanded.

### [-] Dynamic semester mapping
**Priority:** Medium → Dropped
Module codes (WI####) are tied to the curriculum module, not the cohort year.
The built-in table covers all HWR WI modules (ab Jahrgang 2022). Courses in
`Sonstiges/` are genuinely miscellaneous (library, exchange prep, etc.).
New module codes can be added to the table in `src/scraper/course-naming.ts` when needed.

### [x] Scrape only current semester
**Priority:** Low
Done in Pass 56 (v0.10.0): `--semester <N|latest>` flag added to `msc scrape`.
`latest` auto-detects the highest Semester_N among enrolled courses. Also accepts
numeric values (1–6) and named folders (`sonstiges`, `praxistransfer`).
(Dynamic semester mapping was dropped — not needed for this feature.)

---

## Fixes / Polish

### [x] IT-Sicherheit: one file re-downloaded on every scrape
**Priority:** Medium
Fixed in bug-fix pass (v0.9.1): `sshd_config` (extensionless, no dot in path) was
re-promoted from SKIP→DOWNLOAD on every run by case (c) of the promotion loop.
Fix: guard with `!existingDownloadedAt` — correctly saved files have this set,
legacy BUG-C artifacts do not.
