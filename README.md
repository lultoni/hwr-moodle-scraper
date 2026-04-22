# HWR Moodle Scraper

> Download all your Moodle course materials into a local folder — organized by semester, ready for offline study.

- Everything sorted into `Semester_1/`, `Semester_2/`, etc. — no more clicking through Moodle
- Run it again anytime — only new or changed files are downloaded
- Works on macOS, Linux, and Windows

---

## What You Need

| | |
|---|---|
| **Node.js 20+** | Check with `node --version`. Download from [nodejs.org](https://nodejs.org) if needed |
| **HWR Berlin Moodle account** | Your normal HWR login (`moodle.hwr-berlin.de`) |

---

## Installation

```bash
git clone <repo-url>
cd hwr-moodle-scraper
npm install
npm run build
npm install -g .
```

> **macOS:** If prompted to install "Command Line Tools" during `npm install`, click Install. This only happens once.

> **Windows:** Use PowerShell as Administrator. `msc tui` requires [Windows Terminal](https://aka.ms/terminal) for correct display.

Confirm it worked:

```bash
msc --version
```

---

## First Run

```bash
msc scrape
```

A setup wizard asks where to save files and for your Moodle login (stored securely — Keychain on macOS, encrypted file on Linux/Windows). The first download takes 10–20 minutes and roughly 2–3 GB.

**Prefer a menu over commands?** Run `msc tui` for a full interactive interface — no flags to remember.

---

## Everyday Use

| What you want | Command |
|---|---|
| Download new / changed files | `msc scrape` |
| Open the interactive menu | `msc tui` |
| See what you have | `msc status` |
| See what changed in the last run | `msc status --changed` |
| Check for problems | `msc status --issues` |
| Update your Moodle password | `msc auth set` |
| Change the output folder | `msc config set outputDir ~/Documents/Moodle` |

---

## Personal Files

You can add your own notes and files anywhere in the output folder — `msc` only manages files it downloaded and will never delete anything you added yourself.

To permanently protect a folder from ever appearing in status or clean operations, name it **`_User-Files`**:

```
Semester_3/Datenbanken/
├── Vorlesung.pdf        ← managed by msc
└── _User-Files/
    └── my-notes.md      ← invisible to msc
```

To exclude folders like `.obsidian/` or `my-notes/` globally: `msc config set excludePaths "my-notes/**,.obsidian/**"` — or use `msc tui` → Config → `excludePaths`.

---

## Updating

```bash
cd hwr-moodle-scraper
git pull && npm ci && npm run build && npm install -g .
```

`msc` checks GitHub for updates automatically (once per day) and prints a notification with the exact command to run when a new version is available.

---

## Troubleshooting

**macOS asks to install "Command Line Tools"**
Click Install during `npm install`. This only happens once.

**"No courses found"**
Make sure you're enrolled in at least one course on `moodle.hwr-berlin.de`.

**Personal folders showing up in `msc status --issues`**
Add them to the exclude list: `msc config set excludePaths "folder-name/**"` — or use `msc tui` → Config → `excludePaths`.

**Keychain dialog keeps appearing (macOS)**
Select **Always Allow** when prompted (not just "Allow").

**Something went wrong during scrape**
Re-run with `--debug` for a full trace: `msc --debug scrape`. See `msc help debug` for log file options.

---

For advanced usage — all flags, config keys, output structure, and more — see [README-advanced.md](README-advanced.md).
