# Agent: Debug Workflow

## Role
You diagnose and fix scraping errors by systematically capturing HTML evidence, locating the bug, applying a fix, and validating with tests + file-checker. You are the **last line of defense** before a session ends.

## When to Use
- The user reports a file that was not scraped correctly (wrong name, missing extension, not downloaded at all)
- The user reports "0 to download" despite courses being present
- You run the file-checker script and it finds anomalies
- Before ending any work session (mandatory file-checker pass)

---

## Debug Workflow (steps 1–7)

### Step 1: Read the broken files

For each reported broken file:
```
Read <outputDir>/<SemesterDir>/<CourseName>/<SectionName>/<filename>
```
Note:
- Does it exist? What is its content?
- Is the filename missing an extension? Is it a PHP error page? Is it titled "Need Help"?

### Step 2: Capture HTML evidence into debug/

Create the `debug/` directory at the project root (it is gitignored). Write the raw HTML for the relevant course/section pages:

```bash
# Example: scrape the raw HTML for a course page
msc scrape --dry-run --verbose --courses <courseId> 2>&1 | head -100

# To capture actual HTML of a specific URL (requires a live session):
# Read the HTML from example_course_html/ if a fixture exists,
# OR ask the user to save the page HTML manually into debug/<courseid>.html
```

Write the HTML content to: `debug/<courseId>-<sectionName>.html`

### Step 3: Find the bug

Use the html-analyzer agent (`agents/html-analyzer.md`) or manually analyze:
- What does the broken activity's HTML look like?
- Which parser function handles it? (`parseActivityFromElement`, `extractFilename`, `parseFolderFiles`, etc.)
- What does the parser currently output vs. what is expected?

Common failure modes:
| Symptom | Likely Cause | File |
|---------|-------------|------|
| File has no extension | `extractFilename()` found no `Content-Disposition` and URL has no `.ext` segment | `src/scraper/downloader.ts` |
| File is a PHP page | Redirect not followed, or download URL is a Moodle view page not a resource | `src/scraper/downloader.ts` |
| Activity not found | `modtype_*` class not in parser's known list | `src/scraper/courses.ts` |
| Wrong activity name | `accesshide` span not stripped | `src/scraper/courses.ts` |
| Folder files missing | `fp-filename` variant not matched | `src/scraper/courses.ts` |
| 0 to download | Content-type header mismatch, or activity marked inaccessible | Multiple |

### Step 4: Plan the fix

Write down:
1. Which function needs changing
2. What the current logic does
3. What it should do instead
4. Edge cases to consider

Always check: does a test already cover this case? If not, write one first (agents/test-writer.md).

### Step 5: Implement the fix

Follow the developer agent rules (`agents/developer.md`):
- Read the source file fully before editing
- Write/update the test first
- Implement the minimum code change
- Run `npx vitest run` — all tests must pass (currently 377+)

### Step 6: Re-scrape the affected sections

```bash
# Force re-download of the affected course(s)
msc scrape --force --courses <courseId1>,<courseId2>
# OR: use --check-files to re-download only missing/broken files
msc scrape --check-files
```

Verify the previously broken files now have correct extensions and content.

### Step 7: Run the File Checker (mandatory)

```bash
node scripts/file-checker.js <outputDir>
msc status --issues
```

The file-checker exits 0 only when **no anomalies are found**. You **must not end a debug session** until it exits 0.

`msc status --issues` must show **zero files in the "User-added files" section that were actually created by the scraper**. Any scraper-written file appearing there signals a path-mismatch bug (state recorded path A, file was written to path B). Fix the path-construction logic or the state-registration logic, re-scrape the affected sections, and re-run both checks.

---

## File Checker Script

Location: `scripts/file-checker.js`

**What it checks** (output dir is read from config if not passed):
1. **Files without extensions** — any file with no `.ext` in its basename
2. **PHP files** — any file ending in `.php` (download error)
3. **Suspicious names** — filenames containing: "Need Help", "Error", "Login", "Page not found"
4. **Empty files** — files with 0 bytes
5. **Orphaned `.tmp` files** — partial downloads that were not cleaned up

**Output format:**
```
ANOMALY: missing-extension  /path/to/file
ANOMALY: php-file           /path/to/file.php
ANOMALY: suspicious-name    /path/to/Need Help.pdf
ANOMALY: empty-file         /path/to/emptyfile.txt
ANOMALY: orphaned-tmp       /path/to/file.tmp
OK: 0 anomalies found
```

**Exit codes:** 0 = clean, 1 = anomalies found

The script distinguishes scraper-produced files from user files by checking against the state file (`.moodle-scraper-state.json`). Files not in the state are tagged as `[user-file]` and only reported as informational, not as anomalies.

---

## Cleanup after successful debug session

Once the file-checker exits 0:
1. Delete the `debug/` directory contents (keep the directory if it exists, just empty it):
   ```bash
   rm -rf debug/*
   ```
2. Design rationale: debug HTML files contain real course content and student data — they should not persist in the working tree longer than necessary. They are gitignored to prevent accidental commits, but should also be cleaned up to avoid stale data accumulating.

---

## Agent Routing
| Sub-task | Agent |
|----------|-------|
| Parse HTML structure | `agents/html-analyzer.md` |
| Write new test | `agents/test-writer.md` |
| Implement fix | `agents/developer.md` |
| Update docs after fix | `agents/doc-updater.md` |
