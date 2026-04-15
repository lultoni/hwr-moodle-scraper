# Persona Findings — HWR Moodle Scraper UX Sweep

*Cleared after Pass 37 (2026-04-15). Ready for next sweep.*

---

## Section 1 — Persona Coverage Matrix

Feature areas covered by each persona (✓ = touched, — = not applicable to persona).

| Feature Area | Lea 01 | Tobias 02 | Amara 03 | Felix 04 | Jana 05 | David 06 | Sophie 07 | Kenji 08 | Mira 09 | Luca 10 | Nele 11 | Rafael 12 | Hannah 13 | Ben 14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Install / setup | | | | | | | | | | | | | | |
| First-run wizard | | | | | | | | | | | | | | |
| `msc scrape` first run | | | | | | | | | | | | | | |
| `msc scrape --courses` | | | | | | | | | | | | | | |
| `msc scrape --no-descriptions` | | | | | | | | | | | | | | |
| `msc scrape -q` / cron | | | | | | | | | | | | | | |
| `msc scrape --dry-run` | | | | | | | | | | | | | | |
| Incremental sync (2nd run) | | | | | | | | | | | | | | |
| Change report (`+`/`~`) | | | | | | | | | | | | | | |
| `msc status` | | | | | | | | | | | | | | |
| `msc status --issues` | | | | | | | | | | | | | | |
| `msc status --changed` | | | | | | | | | | | | | | |
| `msc status --dismiss-orphans` | | | | | | | | | | | | | | |
| `msc auth set` / `auth status` | | | | | | | | | | | | | | |
| `msc clean` | | | | | | | | | | | | | | |
| `msc reset` | | | | | | | | | | | | | | |
| `msc reset --full` | | | | | | | | | | | | | | |
| `msc archive` | | | | | | | | | | | | | | |
| `msc help <topic>` | | | | | | | | | | | | | | |
| `msc tui` | | | | | | | | | | | | | | |
| `msc config` / `config list` | | | | | | | | | | | | | | |
| Credentials / Keychain | | | | | | | | | | | | | | |
| Env-var credentials (MSC_USERNAME) | | | | | | | | | | | | | | |
| Old entries (orphaned courses) | | | | | | | | | | | | | | |
| User-added files | | | | | | | | | | | | | | |
| `_User-Files/` protection | | | | | | | | | | | | | | |
| Output folder exploration | | | | | | | | | | | | | | |
| `_LastSync.md` file | | | | | | | | | | | | | | |
| `_README.md` file | | | | | | | | | | | | | | |
| `.webloc` / `.url` native shortcuts | | | | | | | | | | | | | | |
| iPad / GoodNotes workflow | | | | | | | | | | | | | | |
| Cross-platform paths | | | | | | | | | | | | | | |
| `postScrapeHook` config | | | | | | | | | | | | | | |
| State migration | | | | | | | | | | | | | | |

---

## Section 2 — Feature Score Table

Rating: 😊 works well · 😐 minor friction · 😕 significant friction · ❌ broken/unusable · — not tested

| Feature | Lea 01 | Tobias 02 | Amara 03 | Felix 04 | Jana 05 | David 06 | Sophie 07 | Kenji 08 | Mira 09 | Luca 10 | Nele 11 | Rafael 12 | Hannah 13 | Ben 14 | Worst |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Install (macOS) | | | | | | | | | | | | | | | |
| Install (Linux/WSL) | | | | | | | | | | | | | | | |
| Install (Windows native) | | | | | | | | | | | | | | | |
| First-run wizard | | | | | | | | | | | | | | | |
| Credential persistence (macOS) | | | | | | | | | | | | | | | |
| Credential persistence (Linux/env) | | | | | | | | | | | | | | | |
| Credential persistence (Windows/env) | | | | | | | | | | | | | | | |
| `msc auth set` / `auth status` | | | | | | | | | | | | | | | |
| Scrape progress / UX | | | | | | | | | | | | | | | |
| Change report (`+`/`~`) | | | | | | | | | | | | | | | |
| `msc scrape --courses` match | | | | | | | | | | | | | | | |
| `msc scrape --no-descriptions` | | | | | | | | | | | | | | | |
| Quiet mode (`-q`) | | | | | | | | | | | | | | | |
| `.md` files in output | | | | | | | | | | | | | | | |
| `.url.txt` / `.webloc` files | | | | | | | | | | | | | | | |
| `msc status` summary | | | | | | | | | | | | | | | |
| `msc status --issues` (old entries) | | | | | | | | | | | | | | | |
| `msc status --issues` (user files) | | | | | | | | | | | | | | | |
| `msc status --changed` | | | | | | | | | | | | | | | |
| `msc status --dismiss-orphans` | | | | | | | | | | | | | | | |
| Old entries cleanup | | | | | | | | | | | | | | | |
| `_User-Files/` protection | | | | | | | | | | | | | | | |
| `msc clean` UX | | | | | | | | | | | | | | | |
| `msc reset` safety (state-only) | | | | | | | | | | | | | | | |
| `msc reset --full` safety | | | | | | | | | | | | | | | |
| `msc archive` | | | | | | | | | | | | | | | |
| `msc help <topic>` | | | | | | | | | | | | | | | |
| `_LastSync.md` output file | | | | | | | | | | | | | | | |
| `_README.md` output file | | | | | | | | | | | | | | | |
| Persistent change log | | | | | | | | | | | | | | | |
| Output folder orientation | | | | | | | | | | | | | | | |
| Cross-platform paths (WSL) | | | | | | | | | | | | | | | |
| State migration | | | | | | | | | | | | | | | |
| atomicWrite + cloud locks | | | | | | | | | | | | | | | |
| GoodNotes annotation safety | | | | | | | | | | | | | | | |
| TUI rendering | | | | | | | | | | | | | | | |
| `msc config list` descriptions | | | | | | | | | | | | | | | |
| `postScrapeHook` config | | | | | | | | | | | | | | | |
| README completeness | | | | | | | | | | | | | | | |

---

## Section 3 — Unified Ticket List

*Empty — all tickets from the previous sweep (UC-01 through UC-38) have been resolved in Pass 37.*

New tickets will be added here after the next persona sweep.

---
