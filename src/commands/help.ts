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
`,
  "clean": `
msc clean
=========
msc clean removes personal files that YOU added to the output folder
(files not downloaded by msc).

  msc clean            → delete user-added files (with confirmation)
  msc clean --move     → move them to "User Files/" instead
  msc clean --dry-run  → preview without making changes
  msc clean --force    → skip confirmation prompt

Files inside a "_User-Files/" directory are always protected and never
shown or touched by msc clean.
`,
  "sidecar": `
Description Files (.description.md)
=====================================
For each Moodle activity that has a description, msc writes a
<filename>.description.md file alongside the main file. These "sidecar"
files contain the activity description converted to Markdown.

They are tracked separately in state and are not counted as downloads.
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
`,
};

// "old-entries" is an alias for "orphaned"
TOPICS["old-entries"] = TOPICS["orphaned"]!;

export function runHelp(topic?: string): void {
  if (!topic) {
    process.stdout.write("Usage: msc help <topic>\n\n");
    process.stdout.write("Available topics:\n");
    const uniqueTopics = Object.entries(TOPICS)
      .filter(([k, v]) => v !== null && k !== "old-entries")
      .map(([k]) => `  ${k}`);
    process.stdout.write(uniqueTopics.join("\n") + "\n");
    process.stdout.write("\n");
    process.stdout.write("  old-entries  (alias for: orphaned)\n");
    return;
  }

  const text = TOPICS[topic.toLowerCase()];
  if (!text) {
    process.stdout.write(`Unknown topic: "${topic}"\n\n`);
    process.stdout.write("Available topics:\n");
    const keys = Object.keys(TOPICS).filter((k) => k !== "old-entries");
    for (const k of keys) process.stdout.write(`  ${k}\n`);
    return;
  }

  process.stdout.write(text.trimStart());
}
