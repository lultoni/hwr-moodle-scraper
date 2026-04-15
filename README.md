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
sudo npm link
```

After this, you can use `msc` from anywhere in Terminal:

```bash
msc --version   # should print a version number
```

> If `msc` doesn't work, try closing and reopening Terminal, or use the full name `moodle-scraper` instead.

### Windows (Native — No WSL)

Open **PowerShell as Administrator** (right-click → Run as administrator):

```powershell
# 1. Download and enter the project
git clone <repo-url>
cd hwr-moodle-scraper

# 2. Install dependencies and build
npm install
npm run build

# 3. Make the "msc" command available globally (no sudo on Windows)
npm install -g .
```

After this, open a new PowerShell window and run `msc --version` to confirm.

> **Credential storage on Windows**: Windows does not have a macOS Keychain equivalent, so msc will prompt for your username and password each run. To avoid this, set environment variables in your PowerShell profile:
> ```powershell
> $env:MSC_USERNAME = "s12345"
> $env:MSC_PASSWORD = "yourpassword"
> msc scrape
> ```

> **TUI on Windows**: `msc tui` requires **Windows Terminal** (available from the Microsoft Store) for correct box-drawing characters. The classic Command Prompt and older PowerShell windows may display garbled borders.

### WSL2 / Linux

WSL2 (Windows Subsystem for Linux) and native Linux are fully supported. Use the standard installation steps above, but:

1. **No Keychain** — store your credentials as environment variables:
   ```bash
   export MSC_USERNAME=s12345
   export MSC_PASSWORD=yourpassword
   ```
   Add these to your `~/.bashrc` or `~/.zshrc` to persist across sessions.

2. **Output directory** — on WSL2, you can save files directly to your Windows filesystem:
   ```bash
   msc config set outputDir /mnt/c/Users/YourName/Documents/Moodle
   ```
   This makes files accessible from both WSL and Windows Explorer.

3. **`--non-interactive` mode** — works automatically when `MSC_USERNAME` and `MSC_PASSWORD` are set:
   ```bash
   msc scrape --non-interactive
   ```

4. **npm global prefix** — if `msc` isn't found after `npm install -g .`, add npm's bin to your PATH:
   ```bash
   export PATH="$(npm prefix -g)/bin:$PATH"
   ```

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

### GoodNotes / iPad Annotation Workflow

If you import PDFs into GoodNotes (or similar apps) for annotation, be aware:

- When a lecturer **updates** a file on Moodle, msc re-downloads it and marks it as `~ updated` in the change report. Your annotated copy in GoodNotes is **not affected** — it's a separate import.
- If you want to keep your annotations aligned with the latest version, re-import the updated file from your output folder into GoodNotes after each `msc scrape`.
- To see what changed in the last scrape: `msc status --changed`

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
