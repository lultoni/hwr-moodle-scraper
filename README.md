# HWR Moodle Scraper

> Download all your Moodle course materials into a local folder — organized by semester, ready for offline study.

- Study on the train, in the library, or anywhere without WiFi
- Everything sorted into `Semester_1/`, `Semester_2/`, etc. — no more clicking through Moodle
- Run it again anytime — it only downloads new or changed files

---

## What You Need

| | |
|---|---|
| **macOS, Linux, or Windows** | All platforms supported. Credentials are saved automatically — macOS uses Keychain, Linux/Windows use an encrypted local file |
| **Node.js 20 or newer** | Check with `node --version` in Terminal. Download from [nodejs.org](https://nodejs.org) if needed |
| **HWR Berlin Moodle account** | Your normal HWR login — same as for `moodle.hwr-berlin.de` |

---

## Installation

### macOS (recommended)

Open Terminal:

```bash
git clone <repo-url>
cd hwr-moodle-scraper
npm install
npm run build
npm install -g .
```

> The first time you run `npm install`, macOS may ask to install "Command Line Tools" — click **Install** when prompted. This only happens once.

Confirm it works:

```bash
msc --version
```

### Linux / WSL2

Same steps as macOS. On WSL2 you can point the output directory at your Windows filesystem:

```bash
msc config set outputDir /mnt/c/Users/YourName/Documents/Moodle
```

### Windows (Native)

Open **PowerShell as Administrator** (right-click → Run as administrator):

```powershell
git clone <repo-url>
cd hwr-moodle-scraper
npm install
npm run build
npm install -g .
```

Open a new PowerShell window and run `msc --version` to confirm.

> **TUI on Windows**: `msc tui` requires **Windows Terminal** (available from the Microsoft Store) for correct display. The classic Command Prompt may show garbled characters.

---

## First Run

```bash
msc scrape
```

On the first run, a setup wizard asks two things:
1. **Where to save files** — pick any folder (default: `~/moodle-scraper-output`)
2. **Your Moodle login** — username and password, stored securely (Keychain on macOS, encrypted file on Linux/Windows)

The first download takes roughly **10–20 minutes** and uses about **2–3 GB** of disk space (4th-semester perspective). After that, re-running `msc scrape` only takes a few minutes since it skips files you already have.

---

## Updating

To pull the latest version:

```bash
cd hwr-moodle-scraper
git pull
npm ci
npm run build
npm install -g .
```

Then verify:

```bash
msc --version
```

---

## Everyday Use

| What you want to do | Command |
|---|---|
| Download new / changed files | `msc scrape` |
| Re-download everything from scratch | `msc scrape --force` |
| See what would be downloaded (without actually downloading) | `msc scrape --dry-run` |
| See a summary of what you have | `msc status` |
| Check for missing files or old entries | `msc status --issues` |
| See what changed in the last scrape | `msc status --changed` |
| Delete all downloaded files and start fresh | `msc reset` |
| Remove personal files you added (with confirmation) | `msc clean` |
| Move personal files to `User Files/` instead of deleting | `msc clean --move` |
| Change the output folder | `msc config set outputDir ~/Documents/Moodle` |
| Update your Moodle password | `msc auth set` |
| See all available commands | `msc --help` |

---

## Your Files Are Safe

Feel free to add your own notes, highlights, or files anywhere inside the output folder. The scraper **only manages files it downloaded** — it will never touch anything you added yourself.

`msc status` tells you how many personal files it sees. When you want to tidy up:

- **`msc clean`** — deletes files in the output folder that aren't tracked by the scraper (after a confirmation prompt). Use this to remove leftovers from old folder structures after updates.
- **`msc clean --move`** — instead of deleting, moves your personal files into a `User Files/` subfolder inside the output directory. Everything stays on disk, just neatly separated from the course content. Safe to run repeatedly — `User Files/` is never touched by the scraper.

If you're unsure, always use `--move` first. You can delete from `User Files/` yourself once you've confirmed nothing important is there.

### Permanently Protecting Personal Files

If you want certain files to be permanently invisible to msc — never shown in status, never offered for deletion — name the containing folder **`_User-Files`**:

```
~/moodle-scraper-output/
├── Semester_3/
│   └── Datenbanken/
│       ├── Vorlesung.pdf          ← managed by msc
│       └── _User-Files/
│           └── my-notes.md        ← completely invisible to msc
└── _User-Files/
    └── extra-resources/           ← also invisible
```

Any directory named `_User-Files` (anywhere in the output tree) is skipped entirely — its contents never appear in `msc status`, `msc status --issues`, or `msc clean`. Unlike `User Files/` (which is created by `msc clean --move`), `_User-Files` folders are ones you create yourself and can be placed at any depth.

> **Note:** Because msc ignores them completely, there is no msc command to list what's inside `_User-Files` folders. Use Finder (macOS), your file explorer (Windows), or `ls` in the terminal to browse them.

### GoodNotes / iPad Annotation Workflow

If you import PDFs into GoodNotes (or similar apps) for annotation:

- When a lecturer **updates** a file on Moodle, msc re-downloads it and marks it as `~ updated` in the change report. Your annotated copy in GoodNotes is **not affected** — it's a separate import.
- Re-import the updated file after each `msc scrape` if you want annotations aligned with the latest version.
- `msc status --changed` shows exactly what was new or updated in the last run.

---

## Output Folder

Your files are organized by semester and course:

```
~/moodle-scraper-output/
├── Semester_1/
│   ├── Betriebswirtschaftliche Grundlagen/
│   │   ├── Einführung/
│   │   │   ├── Vorlesung_1.pdf
│   │   │   └── Übung_1.pdf
│   │   └── Marketing/
│   │       └── Fallstudie.pdf
│   ├── Finanzbuchführung/
│   └── Analysis/
├── Semester_2/
├── Semester_3/
├── Semester_4/
└── Sonstiges/
    ├── Bibliothek benutzen/
    └── ...
```

- **Semester_1 through Semester_6** — courses mapped by their module code
- **Sonstiges** — courses that couldn't be mapped to a semester (library, exchange programs, etc.)
- Inside each course: one folder per Moodle section, containing PDFs, slides, Markdown notes, etc.

---

## Troubleshooting

**macOS asks to install "Command Line Tools"**
Needed once for initial setup. Click Install, wait for it to finish, then re-run `npm install`.

**"No courses found"**
Make sure you're enrolled in at least one course on `moodle.hwr-berlin.de`.

**"0 files to download" on every run**
Everything is already up to date. To verify:
- `msc status` — shows what you have
- `msc scrape --check-files` — re-downloads files missing from disk
- `msc scrape --force` — re-downloads everything regardless

**Keychain dialog keeps appearing (macOS)**
Select **Always Allow** (not just "Allow") when the prompt appears.

**Session expires during a long download**
The scraper re-authenticates automatically. If it fails repeatedly, run `msc auth set` to update your password.

---

## For Developers

```bash
npm test          # run all tests
npm run build     # compile TypeScript → dist/
```

See `docs/REQUIREMENTS.md`, `docs/FEATURE_TIMELINE.md`, and `docs/WORKFLOW.md` for architecture and development process details.
