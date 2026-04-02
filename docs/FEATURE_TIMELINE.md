# Feature Timeline — HWR Moodle Scraper

- **Status**: COMPLETE
- **Last updated**: 2026-04-02
- **Traceability audit**: PASS (75/75)
- **Total steps**: 22
- **Requirements coverage**: 75/75
- **Phase 5 improvements**: Redirect handling, activity name cleanup, folder expansion, type-aware dispatch, debug logging, progress bar fixes, onetopic section names, label content + activity descriptions, semester grouping with state migration, state save bug fix, format-grid multi-page section fetching, format-onetopic multi-tab fetching, modtype CSS class type detection, balanced-div altcontent parser, Moodle 4.x fp-filename span variant, duplicate folder name deduplication, Pass 15–17 (339/339 tests): reset bug fixes (sidecarPath tracking, recursive removeEmptyDirs, --dry-run tree output), course listing improvements (perpage=200, two-step parsing), SHA-256 hashing throughout (atomicWrite→downloader→incremental), iframe-embed fix, course README.md from summary, forum deep-dive (all discussion threads), assignment feedback + grades + submission downloads, file-checker exit-2 blocking, Pass 18 (365/365 tests): TUI + User-Files-Move, Pass 19: TUI + SK Refinements (dead code removal, SK folder structure fix, full-screen rendering, cursor management), Pass 20: Courses AJAX + stderr fix (HWR Moodle AJAX course listing for 42 courses, df stderr pipe to prevent terminal noise, TUI exit silence), Pass 21 (368/368 tests): Scrape bug fixes (.description.md sidecar handling, sync count clarification, resourceworkaround popup-link pattern, legacy mis-classification auto-promotion, data-activityname parsing for customcert cross-references), Pass 22 (377/377 tests): Section Descriptions (extracted section-level summaries `<div class="summarytext">` via depth-counter balancing, 38 `_Abschnittsbeschreibung.md` files written across courses including GPM course greeting and RTG introductions)

---

## Implementation Order Rationale

Steps are ordered by dependency graph: foundational primitives first, then auth, security cross-cuts, filesystem, scraping engine, sync engine, error handling, and CLI commands last (since commands compose all prior layers).

---

## Steps

### STEP-001: Project scaffold and CLI entry point
- **Status**: Complete
- **Requirements**: REQ-CLI-001, REQ-CLI-011, REQ-CLI-013, REQ-CLI-014
- **Dependencies**: none
- **Description**: Bootstrap the project: package manager setup, entry point binary (`moodle-scraper` / alias `msc`), version flag (`--version`/`-V`), top-level help text, and exit code constants. All other steps build on this scaffold.
- **Acceptance Criteria**:
  - [x] AC1: Running `moodle-scraper --version` prints `moodle-scraper x.y.z` and exits 0
  - [x] AC2: Running `moodle-scraper --help` prints usage summary with all top-level commands listed, exits 0
  - [x] AC3: Exit code constants (0 = success, 1 = error, 2 = usage error, 3 = auth error, 4 = network error, 5 = filesystem error) are defined and referenced throughout the codebase
  - [x] AC4: Running an unknown subcommand prints "Unknown command: <cmd>. Run moodle-scraper --help for usage." to stderr and exits 2
- **Test file**: `tests/cli-scaffold.test.ts`
- **Notes**: Pick tech stack here (Node.js + TypeScript recommended for cross-platform scripting; confirm with `docs/TECH_STACK.md` once decided). CLI framework: `commander` or `yargs`.

---

### STEP-002: Config management
- **Status**: Complete
- **Requirements**: REQ-CLI-007, REQ-FS-001
- **Dependencies**: STEP-001
- **Description**: Implement the `config` command and the config file at `~/.config/moodle-scraper/config.json`. Handles `config get <key>`, `config set <key> <value>`, `config list`, and `config reset`. The root output directory key (`outputDir`) defaults to `~/moodle-scraper-output`. On first access, creates `~/.config/moodle-scraper/` with permissions `0700`.
- **Acceptance Criteria**:
  - [x] AC1: `config set outputDir /tmp/test` writes `{"outputDir": "/tmp/test"}` to config file, exits 0
  - [x] AC2: `config get outputDir` prints the current value, exits 0
  - [x] AC3: `config list` prints all key=value pairs, exits 0
  - [x] AC4: `config reset` restores all defaults, prompts for confirmation if not `--non-interactive`, exits 0
  - [x] AC5: Config directory is created with permissions `0700` if absent
  - [x] AC6: Config file is never created with group or other read bits set (`0600`)
- **Test file**: `tests/config.test.ts`
- **Notes**: Config file permissions `0600`; directory `0700`. Do not store secrets in config file.

---

### STEP-003: Filename sanitisation and collision handling
- **Status**: Complete
- **Requirements**: REQ-FS-003, REQ-FS-004
- **Dependencies**: STEP-001
- **Description**: Implement a filename sanitisation function that strips/replaces characters illegal on macOS/Linux/Windows (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, null byte), trims leading/trailing whitespace and dots, caps filenames at 255 bytes (UTF-8), and falls back to `"unnamed"` for blank results. Implement collision resolution by appending `_2`, `_3`, … suffix before the extension.
- **Acceptance Criteria**:
  - [x] AC1: `sanitise("foo/bar.pdf")` returns `"foo_bar.pdf"`
  - [x] AC2: `sanitise("   .hidden  ")` returns `"_hidden_"` (dots/spaces trimmed, not blank)
  - [x] AC3: A filename of 300 bytes is truncated to ≤255 bytes, preserving extension if possible
  - [x] AC4: Blank input returns `"unnamed"`
  - [x] AC5: `resolveCollision("report.pdf", existingSet)` returns `"report_2.pdf"` when `"report.pdf"` is taken; `"report_3.pdf"` when both are taken
- **Test file**: `tests/fs-sanitise.test.ts`
- **Notes**: Sanitisation must be deterministic and side-effect-free (pure function). Used by STEP-007 (folder hierarchy) and STEP-009 (file downloads).

---

### STEP-004: Security primitives — HTTPS enforcement and TLS validation
- **Status**: Complete
- **Requirements**: REQ-SEC-003, REQ-SEC-008, REQ-SEC-006
- **Dependencies**: STEP-001
- **Description**: Create the HTTP client wrapper used throughout the project. Enforces HTTPS-only URLs (rejects any `http://` URL with a clear error), enables TLS certificate validation (no `rejectUnauthorized: false`), sets an honest `User-Agent` header (`moodle-scraper/x.y.z (github.com/…)`), and exposes a typed `get(url, options)` / `post(url, body, options)` interface.
- **Acceptance Criteria**:
  - [x] AC1: Calling `httpClient.get("http://…")` throws `InsecureURLError` before any network request is made
  - [x] AC2: TLS certificate validation is enabled by default; no option to disable it is exposed
  - [x] AC3: Every request carries `User-Agent: moodle-scraper/<version> (…)` header
  - [x] AC4: Connecting to a host with an invalid/self-signed certificate results in a thrown error, not a silent connection
- **Test file**: `tests/http-client.test.ts`
- **Notes**: Use Node.js `https` or `undici`; wrap in a thin adapter so tests can inject a mock transport.

---

### STEP-005: Request rate limiting and jitter
- **Status**: Complete
- **Requirements**: REQ-SEC-005, REQ-SEC-009
- **Dependencies**: STEP-004
- **Description**: Add a rate-limiter middleware to the HTTP client: maximum 5 concurrent requests, minimum 500 ms inter-request delay, and a ±200 ms random jitter applied to every request. Also implements browsing-pattern normalisation (sequential course page scraping, not burst parallel). Jitter and delay values must be configurable via `config set`.
- **Acceptance Criteria**:
  - [x] AC1: When 10 requests are enqueued simultaneously, no more than 5 are in-flight at any moment
  - [x] AC2: Time between consecutive requests is ≥ 500 ms (measurable in tests with fake timers)
  - [x] AC3: Jitter is in the range [300 ms, 700 ms] (500 ± 200) per request
  - [x] AC4: `config set requestDelayMs 1000` is respected on the next scrape run
- **Test file**: `tests/rate-limiter.test.ts`
- **Notes**: Use fake timers in tests to keep the test suite fast.

---

### STEP-006: macOS Keychain credential storage
- **Status**: Complete
- **Requirements**: REQ-AUTH-002, REQ-SEC-001, REQ-SEC-004
- **Dependencies**: STEP-001
- **Description**: Implement the Keychain adapter: `storeCredentials(username, password)`, `readCredentials()`, `deleteCredentials()`. Uses the native macOS Keychain API (via `keytar` or equivalent). Service name is hardcoded to `"moodle-scraper"`. Fails fast with a clear error on non-macOS. Enforces that session files are written with `0600` permissions.
- **Acceptance Criteria**:
  - [x] AC1: `storeCredentials("alice", "secret")` creates a Keychain item retrievable with `readCredentials()`
  - [x] AC2: `deleteCredentials()` removes the Keychain item; subsequent `readCredentials()` returns `null`
  - [x] AC3: On non-macOS, `storeCredentials` throws `PlatformNotSupportedError` with message "This tool requires macOS Keychain. Current platform: <platform>."
  - [x] AC4: `storeCredentials` with an OS permission error prints "Error: could not save credentials to Keychain — <OS error message>." and throws
  - [x] AC5: `readCredentials` with an OS error prints "Error: could not read credentials from Keychain — <OS error message>." and throws
- **Test file**: `tests/keychain.test.ts`
- **Notes**: Mock the native Keychain API in tests (don't touch the real macOS Keychain during CI). `keytar` is the canonical Node.js binding.

---

### STEP-007: Log and output redaction
- **Status**: Complete
- **Requirements**: REQ-SEC-002, REQ-SEC-007
- **Dependencies**: STEP-006
- **Description**: Implement a logger with three levels (info, warn, error) plus verbose and quiet modes. All log output is scanned for credential patterns before emission — any string matching the stored username or password is replaced with `[REDACTED]`. The state file writer is also audited to ensure it never writes credential fields. Logger respects `--verbose`/`--quiet` flags globally.
- **Acceptance Criteria**:
  - [x] AC1: Logging a string containing the stored password emits `[REDACTED]` in its place
  - [x] AC2: Logging a string containing the stored username emits `[REDACTED]` in its place
  - [x] AC3: At `--quiet` level, only errors are printed; at default level, progress + errors; at `--verbose`, all HTTP requests and file writes
  - [x] AC4: The state file JSON output contains no field whose value equals the stored password or username
- **Test file**: `tests/logger.test.ts`
- **Notes**: Redaction must be applied at log emission, not at call sites.

---

### STEP-008: First-run credential prompt and session acquisition
- **Status**: Complete
- **Requirements**: REQ-AUTH-001, REQ-AUTH-003, REQ-AUTH-006
- **Dependencies**: STEP-004, STEP-006, STEP-007
- **Description**: Implement the interactive credential prompt flow: prompt for username (visible), then password (masked via `getpass`/`readline`). Validate non-empty inputs. Attempt Moodle login via HTTP POST; capture session cookies on success; write `~/.config/moodle-scraper/session.json` (`0600`). On failure, print the appropriate error message and exit 1 without storing anything. Does NOT store credentials until login succeeds.
- **Acceptance Criteria**:
  - [x] AC1: Submitting an empty username prints "Username must not be empty." to stderr and re-prompts without advancing to password
  - [x] AC2: Submitting an empty password prints "Password must not be empty." to stderr and re-prompts for password only
  - [x] AC3: Wrong credentials: prints "Login failed: incorrect username or password." to stderr, no Keychain write, exits 1
  - [x] AC4: Network failure during login: prints "Login failed: network error — <detail>." to stderr, no Keychain write, exits 1
  - [x] AC5: Successful login writes session.json at `~/.config/moodle-scraper/session.json` with permissions `0600`
  - [x] AC6: session.json contains at minimum: cookie name, value, domain, path, expiry for each session cookie
  - [x] AC7: Password is never echoed to the terminal or logged
- **Test file**: `tests/auth-prompt.test.ts`
- **Notes**: Moodle login endpoint: POST to `/login/index.php`. Detect login failure by checking if the response URL still contains `/login/`. Mock the HTTP client and terminal I/O in tests.

---

### STEP-009: Session validation and transparent re-authentication
- **Status**: Complete
- **Requirements**: REQ-AUTH-004, REQ-AUTH-005
- **Dependencies**: STEP-008
- **Description**: Before every scrape, validate the stored session by sending a lightweight authenticated request (e.g. GET `/my/` and checking for login page redirect). If expired, transparently re-authenticate using stored Keychain credentials — no user prompt needed. If Keychain credentials are absent, fall back to the interactive prompt (STEP-008). If re-auth fails after 3 attempts, exit 3.
- **Acceptance Criteria**:
  - [x] AC1: Valid session → no re-auth prompt, scrape proceeds immediately
  - [x] AC2: Expired session + valid Keychain credentials → re-auth silently, continue scrape; user sees "Session expired, re-authenticating…" at info level
  - [x] AC3: Expired session + no Keychain entry → falls back to interactive prompt (STEP-008 flow)
  - [x] AC4: 3 consecutive re-auth failures → prints "Authentication failed after 3 attempts." to stderr, exits 3
  - [x] AC5: Session validation request is a lightweight GET (not a full course-list fetch)
- **Test file**: `tests/auth-session.test.ts`
- **Notes**: Check for redirect to `/login/` URL as session-expiry signal.

---

### STEP-010: `auth` subcommands
- **Status**: Complete
- **Requirements**: REQ-AUTH-007, REQ-AUTH-008, REQ-CLI-003, REQ-CLI-004, REQ-CLI-005
- **Dependencies**: STEP-008, STEP-009
- **Description**: Implement `auth set` (triggers the credential prompt flow, replaces existing credentials), `auth clear` (removes Keychain entry and deletes session.json, requires `--force` or confirmation prompt), and `auth status` (prints whether credentials and a valid session exist, without revealing the password).
- **Acceptance Criteria**:
  - [x] AC1: `auth set` with existing credentials prompts "Credentials already stored. Replace? [y/N]" unless `--non-interactive` (in which case exits 2 with error)
  - [x] AC2: `auth clear` removes the Keychain entry and deletes session.json; prints "Credentials and session cleared." to stdout; exits 0
  - [x] AC3: `auth clear` with no stored credentials prints "No credentials stored." and exits 0
  - [x] AC4: `auth status` with valid credentials prints "Credentials: stored (username: <username>)\nSession: valid" and exits 0
  - [x] AC5: `auth status` with no credentials prints "Credentials: not stored" and exits 0
  - [x] AC6: `auth status` never prints the password
- **Test file**: `tests/auth-commands.test.ts`
- **Notes**: `--non-interactive` flag (REQ-CLI-010) must suppress all confirmation prompts and fail instead.

---

### STEP-011: Filesystem output structure
- **Status**: Complete
- **Requirements**: REQ-FS-002, REQ-FS-005, REQ-FS-006, REQ-FS-008
- **Dependencies**: STEP-002, STEP-003
- **Description**: Implement the output folder hierarchy builder: `<outputDir>/<CourseName>/<SectionName>/<filename>`. Creates intermediate directories on demand. Implements atomic file writes (write to `.tmp` then rename). On startup, scans output dir for `.tmp` orphans and deletes them. Pre-checks available disk space before downloads begin; aborts with error if headroom < 100 MB (configurable).
- **Acceptance Criteria**:
  - [x] AC1: Given course "Macro 2024" section "Week 1", creates `<outputDir>/Macro_2024/Week_1/` (sanitised names)
  - [x] AC2: File write is atomic: `.tmp` file appears first, then renamed on completion; partial `.tmp` never left on success
  - [x] AC3: On startup, any `*.tmp` files in outputDir are deleted and logged at warn level
  - [x] AC4: If available disk space < 100 MB, prints "Error: insufficient disk space — <available> available, 100 MB required." to stderr and exits 5
  - [x] AC5: Disk space threshold is configurable via `config set minFreeDiskMb <N>`
- **Test file**: `tests/fs-output.test.ts`
- **Notes**: Use `fs.rename` for atomic move on same filesystem. For cross-filesystem scenarios (temp on different mount), copy then delete.

---

### STEP-012: Optional metadata sidecar
- **Status**: Complete
- **Requirements**: REQ-FS-007
- **Dependencies**: STEP-011
- **Description**: When `--metadata` flag is passed to `scrape`, write a `<filename>.meta.json` sidecar alongside each downloaded file. Sidecar contains: source URL, download timestamp (ISO 8601), file size bytes, SHA-256 hash, Moodle resource ID, course name, section name.
- **Acceptance Criteria**:
  - [x] AC1: `scrape --metadata` produces `lecture1.pdf.meta.json` alongside `lecture1.pdf`
  - [x] AC2: Sidecar JSON contains all 7 required fields (sourceUrl, downloadedAt, sizeBytes, sha256, moodleResourceId, courseName, sectionName)
  - [x] AC3: `scrape` without `--metadata` produces no sidecar files
  - [x] AC4: Sidecar SHA-256 matches the actual file content
- **Test file**: `tests/fs-sidecar.test.ts`
- **Notes**: Compute SHA-256 during streaming download to avoid re-reading the file.

---

### STEP-013: Course listing and content tree traversal
- **Status**: Complete
- **Requirements**: REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-SCRAPE-012
- **Dependencies**: STEP-004, STEP-005, STEP-009, STEP-011
- **Description**: Implement Moodle API calls (or HTML scraping) to retrieve the list of enrolled courses and then recursively traverse each course's content tree (sections → activities → resources). Build an in-memory content tree data structure. Handle inaccessible/restricted activities gracefully (skip + log, no crash). Use Moodle's REST API (`/webservice/rest/server.php`) if a token is available; fall back to HTML parsing.
- **Acceptance Criteria**:
  - [x] AC1: Returns a list of enrolled courses each with: courseId, courseName, courseUrl
  - [x] AC2: For each course, returns sections each with: sectionName, activities list (activityType, activityName, url, isAccessible)
  - [x] AC3: Restricted/hidden activities are included in the tree with `isAccessible: false`; they are logged at debug level and skipped during download
  - [x] AC4: An empty course (no sections) is represented as `sections: []` without error
  - [x] AC5: If the course list endpoint returns an error, the error is propagated (not swallowed)
- **Test file**: `tests/scrape-course-listing.test.ts`
- **Notes**: Mock HTTP responses using recorded fixtures. Moodle AJAX endpoint: `/lib/ajax/service.php`. Moodle WS token endpoint: `/login/token.php`.

---

### STEP-014: File download engine (streaming + concurrency)
- **Status**: Complete
- **Requirements**: REQ-SCRAPE-003, REQ-SCRAPE-004, REQ-SCRAPE-009, REQ-SCRAPE-010, REQ-SCRAPE-011
- **Dependencies**: STEP-005, STEP-011, STEP-012, STEP-013
- **Description**: Implement the streaming file download engine. Downloads are streamed to disk (no full file in memory). A configurable concurrency pool limits simultaneous downloads (default 3, max 10, configurable via `config set maxConcurrentDownloads`). A progress display shows per-file progress bars and a global summary. Folder-type activities are recursively traversed and all contained files are downloaded.
- **Acceptance Criteria**:
  - [x] AC1: A 100 MB file is downloaded without loading it fully into memory (RSS stays < 50 MB above baseline during download)
  - [x] AC2: With `maxConcurrentDownloads=3`, no more than 3 downloads are active simultaneously
  - [x] AC3: Progress display shows filename, download speed (KB/s), percentage, and ETA per file
  - [x] AC4: Folder activities: all contained files are downloaded into a matching subdirectory
  - [x] AC5: `config set maxConcurrentDownloads 5` takes effect on next run
- **Test file**: `tests/scrape-download.test.ts`
- **Notes**: Use Node.js streams pipeline. Progress display library: `cli-progress` or equivalent. Concurrency pool: `p-limit` or custom semaphore.

---

### STEP-015: Content type handlers (URLs, assignments, forums, labels)
- **Status**: Complete
- **Requirements**: REQ-SCRAPE-005, REQ-SCRAPE-006, REQ-SCRAPE-007, REQ-SCRAPE-008
- **Dependencies**: STEP-013, STEP-014
- **Description**: Implement handlers for non-file content types: (1) External URLs — write `<activityName>.url.txt` containing the URL. (2) Assignments — write `<assignmentName>_description.md` containing the HTML-to-Markdown converted description + due date + submission instructions. (3) Forums/Announcements — write `<forumName>/<postTitle>.md` per post with author, timestamp, body. (4) Inline Labels — write `<section>/_labels.md` accumulating all label text in section order.
- **Acceptance Criteria**:
  - [x] AC1: External URL activity produces `<name>.url.txt` with the URL on the first line
  - [x] AC2: Assignment produces `<name>_description.md` with fields: title, due date (ISO 8601 or "No due date"), description (Markdown), submission type
  - [x] AC3: Forum post produces `<forumName>/<postTitle>.md` with front-matter: author, timestamp, subject
  - [x] AC4: Label/text activity appends its sanitised HTML-to-Markdown content to `_labels.md` in the same section folder
- **Test file**: `tests/scrape-content-types.test.ts`
- **Notes**: HTML-to-Markdown conversion: use `turndown` or equivalent. Do not embed raw HTML in output files.

---

### STEP-016: State file management
- **Status**: Complete
- **Requirements**: REQ-SYNC-001, REQ-SYNC-002, REQ-SEC-007
- **Dependencies**: STEP-002, STEP-011
- **Description**: Implement the sync state file at `<outputDir>/.moodle-scraper-state.json`. Schema: `{ version, lastSyncAt, courses: { [courseId]: { name, sections: { [sectionId]: { files: { [resourceId]: { name, url, localPath, hash, lastModified, status } } } } } } }`. Write atomically (temp + rename). Never store username, password, or session cookies in the state file.
- **Acceptance Criteria**:
  - [x] AC1: After a successful scrape, state file exists at `<outputDir>/.moodle-scraper-state.json`
  - [x] AC2: State file contains `version`, `lastSyncAt` (ISO 8601), and all scraped courses/files
  - [x] AC3: State file JSON contains no field with value equal to the stored password
  - [x] AC4: State file is written atomically (rename from `.tmp`)
  - [x] AC5: `REQ-SYNC-002`: state file location follows the outputDir setting, not hardcoded to `~/`
- **Test file**: `tests/sync-state.test.ts`
- **Notes**: Schema version field enables future migrations.

---

### STEP-017: Incremental sync engine
- **Status**: Complete
- **Requirements**: REQ-SYNC-003, REQ-SYNC-004, REQ-SYNC-005, REQ-SYNC-006, REQ-SYNC-007, REQ-SYNC-008, REQ-SYNC-009
- **Dependencies**: STEP-016, STEP-014
- **Description**: Implement incremental sync logic: compare current Moodle content tree against state file. Download only new or changed files (changed = different `lastModified` or content hash). Detect orphaned local files (in state but not on Moodle) and log them. Detect new courses and removed courses. Implement `--force` flag to wipe state and re-download everything. Implement `--dry-run` flag to print planned actions without executing them.
- **Acceptance Criteria**:
  - [x] AC1: Second run with no Moodle changes: 0 files downloaded, "Nothing to sync." logged
  - [x] AC2: A changed file (new `lastModified`) is re-downloaded on the next run
  - [x] AC3: A file removed from Moodle is logged as "Orphaned: <path>" and left on disk (not deleted) unless `--remove-orphans` is passed
  - [x] AC4: A new course is detected, logged as "New course: <name>", and fully downloaded
  - [x] AC5: `--force` re-downloads all files regardless of state
  - [x] AC6: `--dry-run` prints all planned actions (download/skip/orphan) without writing any files or updating state
- **Test file**: `tests/sync-incremental.test.ts`
- **Notes**: Hash comparison is the ground-truth change detector; `lastModified` is a fast pre-filter.

---

### STEP-018: Error handling — network errors and HTTP status codes
- **Status**: Complete
- **Requirements**: REQ-ERR-001, REQ-ERR-002, REQ-ERR-003, REQ-ERR-004, REQ-ERR-005, REQ-ERR-006, REQ-ERR-007
- **Dependencies**: STEP-004, STEP-005, STEP-013
- **Description**: Implement error handling middleware in the HTTP client and scrape engine: (1) Timeouts: 30 s connect, 120 s read; exponential backoff retry (3 attempts, 2×) for transient errors. (2) 401 → trigger re-auth (STEP-009). (3) 403 → log "Access denied: <url>", skip resource, continue. (4) 404 → log "Not found: <url>", mark as orphan in state. (5) 429 → respect `Retry-After` header; wait and retry up to 3 times. (6) 5xx → exponential backoff retry 3×; if all fail, log error and skip. (7) Moodle maintenance page detection (check for `site-maintenance` CSS class in response body) → abort with "Moodle is in maintenance mode." exit 4.
- **Acceptance Criteria**:
  - [x] AC1: A 30-second timeout fires on a stalled connection; retried up to 3 times with exponential backoff
  - [x] AC2: HTTP 401 triggers transparent re-auth via STEP-009 flow
  - [x] AC3: HTTP 403 logs the URL and continues without crashing
  - [x] AC4: HTTP 429 with `Retry-After: 60` waits 60 s then retries (capped at 3 retries)
  - [x] AC5: HTTP 503 retried 3× with backoff; if all fail, logs error, skips resource, continues
  - [x] AC6: Moodle maintenance page → prints "Moodle is in maintenance mode. Try again later." to stderr, exits 4
- **Test file**: `tests/error-http.test.ts`
- **Notes**: Use fake timers for retry/backoff tests. Maintenance mode check must run on every HTML response.

---

### STEP-019: Error handling — filesystem and graceful shutdown
- **Status**: Complete
- **Requirements**: REQ-ERR-008, REQ-ERR-009, REQ-ERR-010, REQ-ERR-011, REQ-ERR-012, REQ-ERR-013
- **Dependencies**: STEP-011, STEP-016
- **Description**: Implement: (1) Disk-full detection during streaming download — abort download, delete partial file, log "Error: disk full — <path>: <OS error>.", continue other downloads. (2) Output dir inaccessible → print specific error, exit 5. (3) Corrupt/unreadable state file → log warning, treat as first run (full re-sync), do not crash. (4) Unexpected Moodle page structure (missing expected DOM elements) → log "Warning: unexpected page structure at <url> — <detail>", skip activity. (5) SIGINT/SIGTERM → flush state file, delete all `.tmp` files, print "Interrupted. Progress saved." and exit 0.
- **Acceptance Criteria**:
  - [x] AC1: Disk-full error during download: partial file deleted, error logged, scrape continues with next file
  - [x] AC2: Output dir missing: prints "Error: output directory <path> is not accessible — <OS error>." to stderr, exits 5
  - [x] AC3: Corrupt state file: logs "Warning: state file corrupt — starting fresh sync.", proceeds as first run
  - [x] AC4: Unexpected page structure: logs warning with URL, skips the activity, does not crash
  - [x] AC5: SIGINT: state file flushed, all `.tmp` files deleted, prints "Interrupted. Progress saved.", exits 0
- **Test file**: `tests/error-fs.test.ts`
- **Notes**: Register SIGINT/SIGTERM handlers at program startup (STEP-001). Process signal tests require careful teardown.

---

### STEP-020: `scrape` command
- **Status**: Complete
- **Requirements**: REQ-CLI-002, REQ-CLI-008, REQ-CLI-009, REQ-CLI-010
- **Dependencies**: STEP-009, STEP-013, STEP-014, STEP-015, STEP-016, STEP-017, STEP-018, STEP-019
- **Description**: Wire up the top-level `scrape` command with all its flags: `--output-dir <path>` (overrides config), `--courses <id,...>` (scrape specific courses only), `--force` (full re-sync), `--dry-run`, `--metadata`, `--verbose`/`-v`, `--quiet`/`-q`, `--non-interactive`. Orchestrates the full scrape pipeline: auth → course list → content tree → download → state update.
- **Acceptance Criteria**:
  - [x] AC1: `scrape` without arguments runs a full incremental sync using config outputDir
  - [x] AC2: `scrape --output-dir /tmp/test` uses `/tmp/test` as the output directory for this run only
  - [x] AC3: `scrape --courses 42,43` scrapes only courses with IDs 42 and 43
  - [x] AC4: `scrape --dry-run` prints planned actions, exits 0, writes no files
  - [x] AC5: `scrape --non-interactive` exits 3 (auth error) if no credentials are stored rather than prompting
  - [x] AC6: `scrape --quiet` suppresses all output except errors
  - [x] AC7: `scrape --verbose` logs every HTTP request and file write
- **Test file**: `tests/cmd-scrape.test.ts`
- **Notes**: This is the integration test for the entire pipeline. Use recorded Moodle fixtures.

---

### STEP-021: `status` command and log file
- **Status**: Complete
- **Requirements**: REQ-CLI-006, REQ-CLI-012, REQ-CLI-016
- **Dependencies**: STEP-016, STEP-017, STEP-020
- **Description**: Implement `status` command: reads state file and prints a summary — last sync time, total courses, total files, orphaned files count, pending changes. Implement `status --issues` detail view listing each orphan/error. Implement `--log-file <path>` flag (or `config set logFile <path>`) to tee all log output to a file with timestamps. Log file is created with `0600` permissions.
- **Acceptance Criteria**:
  - [x] AC1: `status` prints: "Last sync: <ISO timestamp>\nCourses: <N>\nFiles: <N>\nOrphaned: <N>"
  - [x] AC2: `status --issues` lists each orphaned file with its local path and last known Moodle URL
  - [x] AC3: `status` with no state file prints "No sync history. Run 'scrape' to start."
  - [x] AC4: `--log-file /tmp/msc.log` writes all log output to the file in addition to stderr
  - [x] AC5: Log file permissions are `0600`
- **Test file**: `tests/cmd-status.test.ts`
- **Notes**: Log file must redact credentials (STEP-007 logger is used).

---

### STEP-022: First-run setup wizard
- **Status**: Complete
- **Requirements**: REQ-CLI-015
- **Dependencies**: STEP-010, STEP-020, STEP-021
- **Description**: Implement the first-run setup wizard that fires automatically when neither credentials are stored nor a config file exists. Guides the user through: (1) setting the output directory, (2) entering credentials (STEP-008 flow), (3) optionally running a `scrape --dry-run` to preview. At the end, prints a summary of configured settings.
- **Acceptance Criteria**:
  - [x] AC1: On first invocation (no config, no credentials), wizard fires before any scrape logic
  - [x] AC2: Wizard prompts for outputDir with a sensible default (`~/moodle-scraper-output`); pressing Enter accepts the default
  - [x] AC3: After wizard completes, credentials are stored and config is written
  - [x] AC4: `--non-interactive` suppresses the wizard; if credentials are absent, exits 3
  - [x] AC5: Wizard does not fire on subsequent runs when config and credentials exist
- **Test file**: `tests/cmd-wizard.test.ts`
- **Notes**: Wizard is skipped entirely in CI (detect via `--non-interactive` or `CI` env var).

---

## Traceability Index

| REQ ID | Covered by Step(s) |
|--------|--------------------|
| REQ-AUTH-001 | STEP-008 |
| REQ-AUTH-002 | STEP-006 |
| REQ-AUTH-003 | STEP-008 |
| REQ-AUTH-004 | STEP-009 |
| REQ-AUTH-005 | STEP-009 |
| REQ-AUTH-006 | STEP-008 |
| REQ-AUTH-007 | STEP-010 |
| REQ-AUTH-008 | STEP-010 |
| REQ-SCRAPE-001 | STEP-013 |
| REQ-SCRAPE-002 | STEP-013 |
| REQ-SCRAPE-003 | STEP-014 |
| REQ-SCRAPE-004 | STEP-014 |
| REQ-SCRAPE-005 | STEP-015 |
| REQ-SCRAPE-006 | STEP-015 |
| REQ-SCRAPE-007 | STEP-015 |
| REQ-SCRAPE-008 | STEP-015 |
| REQ-SCRAPE-009 | STEP-014 |
| REQ-SCRAPE-010 | STEP-014 |
| REQ-SCRAPE-011 | STEP-014 |
| REQ-SCRAPE-012 | STEP-013 |
| REQ-SYNC-001 | STEP-016 |
| REQ-SYNC-002 | STEP-016 |
| REQ-SYNC-003 | STEP-017 |
| REQ-SYNC-004 | STEP-017 |
| REQ-SYNC-005 | STEP-017 |
| REQ-SYNC-006 | STEP-017 |
| REQ-SYNC-007 | STEP-017 |
| REQ-SYNC-008 | STEP-017 |
| REQ-SYNC-009 | STEP-017 |
| REQ-FS-001 | STEP-002 |
| REQ-FS-002 | STEP-011 |
| REQ-FS-003 | STEP-003 |
| REQ-FS-004 | STEP-003 |
| REQ-FS-005 | STEP-011 |
| REQ-FS-006 | STEP-011 |
| REQ-FS-007 | STEP-012 |
| REQ-FS-008 | STEP-011 |
| REQ-CLI-001 | STEP-001 |
| REQ-CLI-002 | STEP-020 |
| REQ-CLI-003 | STEP-010 |
| REQ-CLI-004 | STEP-010 |
| REQ-CLI-005 | STEP-010 |
| REQ-CLI-006 | STEP-021 |
| REQ-CLI-007 | STEP-002 |
| REQ-CLI-008 | STEP-020 |
| REQ-CLI-009 | STEP-020 |
| REQ-CLI-010 | STEP-020 |
| REQ-CLI-011 | STEP-001 |
| REQ-CLI-012 | STEP-021 |
| REQ-CLI-013 | STEP-001 |
| REQ-CLI-014 | STEP-001 |
| REQ-CLI-015 | STEP-022 |
| REQ-CLI-016 | STEP-021 |
| REQ-SEC-001 | STEP-006 |
| REQ-SEC-002 | STEP-007 |
| REQ-SEC-003 | STEP-004 |
| REQ-SEC-004 | STEP-006 |
| REQ-SEC-005 | STEP-005 |
| REQ-SEC-006 | STEP-004 |
| REQ-SEC-007 | STEP-016 |
| REQ-SEC-008 | STEP-004 |
| REQ-SEC-009 | STEP-005 |
| REQ-ERR-001 | STEP-018 |
| REQ-ERR-002 | STEP-018 |
| REQ-ERR-003 | STEP-018 |
| REQ-ERR-004 | STEP-018 |
| REQ-ERR-005 | STEP-018 |
| REQ-ERR-006 | STEP-018 |
| REQ-ERR-007 | STEP-018 |
| REQ-ERR-008 | STEP-019 |
| REQ-ERR-009 | STEP-019 |
| REQ-ERR-010 | STEP-019 |
| REQ-ERR-011 | STEP-019 |
| REQ-ERR-012 | STEP-019 |
| REQ-ERR-013 | STEP-019 |
