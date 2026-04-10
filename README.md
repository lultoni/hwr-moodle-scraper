# HWR Moodle Scraper

> Download all your Moodle course materials into a local folder — organized by semester, ready for offline study.

- Study on the train, in the library, or anywhere without WiFi
- Everything sorted into `Semester_1/`, `Semester_2/`, etc. — no more clicking through Moodle
- Run it again anytime — it only downloads new or changed files

---

## What You Need

| | |
|---|---|
| **macOS, Linux, or Windows** | macOS recommended (credentials saved in Keychain). On Linux/Windows, you'll be asked for your password each run |
| **Node.js 20 or newer** | Check with `node --version` in Terminal. Download from [nodejs.org](https://nodejs.org) if needed |
| **HWR Berlin Moodle account** | Your normal HWR login — same as for `moodle.hwr-berlin.de` |

> On macOS, the first time you run `npm install` (next section), macOS may ask you to install "Command Line Tools". Click **Install** when prompted — this is normal and only happens once.

---

## Installation

Open Terminal and run these commands one by one:

```bash
# 1. Download the project (or unzip it if you got it as a .zip)
git clone <repo-url>
cd hwr-moodle-scraper

# 2. Install dependencies
npm install

# 3. Build the project
npm run build

# 4. Make the "msc" command available everywhere
npm link
```

After this, you can use `msc` from anywhere in Terminal:

```bash
msc --version   # should print a version number
```

> If `msc` doesn't work, try closing and reopening Terminal, or use the full name `moodle-scraper` instead.

---

## First Run

```bash
msc scrape
```

On the first run, a setup wizard asks you two things:
1. **Where to save files** — pick any folder (default: `~/moodle-scraper-output`)
2. **Your Moodle login** — username and password, stored securely in your Mac's Keychain (never saved as a file)

macOS will show a Keychain permission dialog — click **Always Allow** so it doesn't ask again.

The first download takes roughly **10-20 minutes** and uses about **2-3 GB** of disk space (depending on how many courses you're enrolled in - this is from a 4th semester perspective). After that, re-running `msc scrape` only takes a few minutes since it skips files you already have.

---

## Everyday Use

| What you want to do | Command |
|---|---|
| Download new / changed files | `msc scrape` |
| Re-download everything from scratch | `msc scrape --force` |
| See what would be downloaded (without actually downloading) | `msc scrape --dry-run` |
| See a summary of what you have | `msc status` |
| Delete all downloaded files and start fresh | `msc reset` |
| Delete leftover files from old folder structures | `msc clean` |
| Move leftover files to a "User Files" folder instead | `msc clean --move` |
| Change the output folder | `msc config set outputDir ~/Documents/Moodle` |
| Update your Moodle password | `msc auth set` |
| See all available commands | `msc --help` |

---

## Your Files Are Safe

Feel free to add your own notes, highlights, or files alongside the downloaded content. The scraper **only manages files it downloaded** and will never delete your personal additions.

`msc status` shows how many personal files you have. If you want to clean up old leftover files (e.g. after the scraper reorganized folders), use `msc clean` — it only touches files that aren't tracked by the scraper.

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
│   ├── Projektmanagement/
│   ├── Rechnersysteme/
│   └── Netzwerke/
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
This is needed once for the initial setup. Click Install and wait for it to finish, then run `npm install` again.

**"No courses found"**
The scraper searches your Moodle dashboard for courses. If none are found, make sure you're enrolled in at least one course on `moodle.hwr-berlin.de`.

**"0 files to download" on every run**
Everything is already up to date. To double-check:
- `msc status` — shows what you have
- `msc scrape --check-files` — re-downloads files that got deleted from disk
- `msc scrape --force` — re-downloads everything regardless

**Keychain dialog keeps appearing**
Select **Always Allow** (not just "Allow") when macOS shows the Keychain prompt.

**Session expires during a long download**
The scraper automatically re-authenticates. If it fails repeatedly, update your password with `msc auth set`.

---

## For Developers

```bash
npm test          # run all tests
npm run build     # compile TypeScript → dist/
```

See `docs/REQUIREMENTS.md`, `docs/FEATURE_TIMELINE.md`, and `docs/WORKFLOW.md` for architecture and development process details.
