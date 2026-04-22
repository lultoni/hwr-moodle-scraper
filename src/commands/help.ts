// UC-20: msc help <topic>
// Plain-language explanations for common msc concepts.

const TOPICS: Record<string, string | null> = {
  "orphaned": `
Old Entries (from ended courses)
=================================
When a Moodle course ends, its files remain in your output folder, but msc
no longer sees them in your enrolments. These are tracked in the state as
"old entries" — they are NOT deleted automatically.

To review them:
  msc status --issues

To remove old state entries (files stay on disk):
  msc status --dismiss-orphans

To also delete the files:
  msc reset --files
`,
  "old-entries": null,  // alias handled below
  "user-files": `
User-Added Files
================
Files in your output folder that msc didn't download are "user-added".
msc never deletes them during a normal scrape.

To see them:
  msc status --issues

To delete them:
  msc clean

To move them to a protected folder instead:
  msc clean --move

To permanently protect a folder from msc:
  Create a folder named "_User-Files/" — msc will never touch its contents.
`,
  "state": `
Sync State
==========
msc tracks every downloaded file in a hidden state file:
  <outputDir>/.moodle-scraper-state.json

This state file records file paths, hashes, and timestamps, which lets
msc skip unchanged files on subsequent runs (incremental sync).

To clear the state (files are kept on disk):
  msc reset

To clear state AND delete all files:
  msc reset --files
`,
  "reset": `
msc reset
=========
By default, msc reset only clears the sync state file. Your downloaded
files are NOT deleted. Flags compose freely:

  msc reset                           → clears state, keeps files
  msc reset --state                   → same (explicit)
  msc reset --files                   → deletes tracked files + state
  msc reset --config                  → resets config to defaults
  msc reset --credentials             → clears saved credentials + session
  msc reset --files --config --credentials  → full wipe (alias: --full)
  msc reset --dry-run                 → preview without making changes

After a failed scrape, to retry with a clean state (keeps your files):
  msc reset --state && msc scrape
`,
  "clean": `
msc clean
=========
msc clean removes personal files that YOU added to the output folder
(files not downloaded by msc). It does NOT touch scraper-downloaded files.

  msc clean            → delete user-added files (with confirmation)
  msc clean --move     → move them to "User Files/" instead
  msc clean --dry-run  → preview without making changes
  msc clean --force    → skip confirmation prompt

Files inside a "_User-Files/" directory are always protected and never
shown or touched by msc clean.

Use "msc reset" (not msc clean) to remove files that msc downloaded.
`,
  "sidecar": `
Description Files (.description.md)
=====================================
For each Moodle activity that has a description, msc writes a
<filename>.description.md file alongside the main file. These "sidecar"
files contain the activity description converted to Markdown.

They are tracked separately in state and are not counted as downloads.

To skip sidecar generation entirely (binaries only):
  msc scrape --no-descriptions
`,
  "sync": `
Incremental Sync
================
On the first run, msc downloads everything. On subsequent runs, it only
downloads files whose hash has changed (or that are new).

The sync state is stored in <outputDir>/.moodle-scraper-state.json.
If you delete this file, the next run treats everything as new and
re-downloads all files.

To see what changed in the last run:
  msc status --changed

To re-download everything regardless of state:
  msc scrape --force

To re-download any files missing from disk (even if state says up-to-date):
  msc scrape --check-files
`,
  "update": `
Updating msc
============
To update to a newer version of msc, run in the cloned repo directory:

  git pull
  npm install
  npm run build
  npm install -g .

To check the current version:
  msc --version

msc checks GitHub for updates automatically (once per 24h) and prints
a notification when a newer version is available.
`,
  "debug": `
Diagnosing Errors
=================
If msc crashes with a cryptic error message, re-run with --debug to get
a full stack trace:

  msc --debug scrape

To also save a complete debug log to a file (includes all HTTP requests
and file operations at DEBUG level):

  msc config set logFile ~/moodle-debug.log
  msc scrape
  # inspect ~/moodle-debug.log

The log file always writes at DEBUG level regardless of the terminal
output level. Disable it again with:

  msc config set logFile null
`,
  "archive": `
msc archive (experimental)
===========================
Removes a course from sync state without touching files on disk. Use this
when a course has ended and you want msc status to stop showing it, but
you want to keep the downloaded files.

  msc archive                     → pick from a list of courses
  msc archive --courses <keyword> → filter by keyword
  msc archive --dry-run           → preview without making changes

After archiving, the course no longer appears in msc status output.
The files remain exactly where they are on disk.
`,
  "config": `
msc config
==========
View and change persistent settings.

  msc config list            → show all keys and their current values
  msc config get <key>       → print one value
  msc config set <key> <val> → update a value

Common keys:

  outputDir              Folder where scraped files are saved
  courseSearch           Default keyword filter for every scrape
  excludePaths           Glob patterns ignored by status/clean (comma-separated)
  maxConcurrentDownloads Number of parallel downloads (default: 3)
  requestDelayMs         Delay between requests in ms (default: 500)
  logFile                Path for a persistent debug log (null = disabled)
  postScrapeHook         Shell command to run after a scrape that downloads something
  checkUpdates           Auto-check GitHub for new versions (default: true)

All keys can also be managed interactively via: msc tui → Config
`,
  "ignored": `
Ignored Files and Directories
==============================
Use "msc ignored" to see everything that msc treats as invisible:

  1. Exclude patterns — glob patterns applied when scanning for user-
     added files. Built-in defaults (.claude/**, .git/**) are always
     active. Add custom patterns with:
       msc config set excludePaths "my-notes/**,.obsidian/**"
     Or manage interactively: msc tui → Config → excludePaths

  2. _User-Files directories — any folder named "_User-Files" anywhere
     in your output tree is skipped entirely. Create these yourself to
     permanently protect personal files from msc status and msc clean.

  3. User Files/ directory — created by "msc clean --move" to hold
     files that were relocated out of the output folder.

Files in any of these locations never appear in "msc status" output.
`,
};

// "old-entries" is an alias for "orphaned"
TOPICS["old-entries"] = TOPICS["orphaned"]!;

/** All real help topic names (alias "old-entries" excluded). */
export const HELP_TOPICS: string[] = Object.entries(TOPICS)
  .filter(([k, v]) => v !== null && k !== "old-entries")
  .map(([k]) => k);

export function runHelp(topic?: string): void {
  if (!topic) {
    process.stdout.write("Usage: msc help <topic>\n\n");
    process.stdout.write("Available topics:\n");
    process.stdout.write(HELP_TOPICS.map((k) => `  ${k}`).join("\n") + "\n");
    process.stdout.write("\n");
    process.stdout.write("  old-entries  (alias for: orphaned)\n");
    return;
  }

  const text = TOPICS[topic.toLowerCase()];
  if (!text) {
    process.stdout.write(`Unknown topic: "${topic}"\n\n`);
    process.stdout.write("Available topics:\n");
    for (const k of HELP_TOPICS) process.stdout.write(`  ${k}\n`);
    return;
  }

  process.stdout.write(text.trimStart());
}
