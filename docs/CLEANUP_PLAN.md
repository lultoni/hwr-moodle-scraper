# HWR Moodle Scraper — Deep Cleanup Plan

> **Goal**: Bring every file in this repository to the highest quality it can be — no dead code, no duplication, no bugs, no fragile patterns, clean types, consistent style, every test solid. This plan is exhaustive and ordered by impact. Work top-to-bottom.

---

## How to Read This Plan

Each section is a self-contained cleanup pass. Within each section, items are ordered by severity:
- **[BUG]** — Actual incorrect behaviour
- **[SEC]** — Security concern
- **[DUP]** — Duplicated code that should be extracted
- **[TYPE]** — TypeScript type safety gap
- **[QUAL]** — Code quality / clarity / naming issue
- **[TEST]** — Missing or weak test coverage
- **[DOC]** — Documentation gap

A "file" annotation like `(logger.ts:35)` means line 35 of that file.

---

## PASS 1 — Bug Fixes (do first, highest impact)

### 1.1 `logger.ts` — File descriptor leak + redundant chmod
**[BUG]** `ensureLogFile` (logger.ts:35) calls `openSync(path, "a", 0o600)` but never closes the returned `fd`.
The comment says "fd closed automatically by GC" — this is incorrect; Node does not GC file descriptors reliably.
In addition, `chmodSync` is called twice: once inside the try-block (line 36) and unconditionally after the try-block (line 41).

**Fix**:
```ts
function ensureLogFile(path: string): void {
  try {
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
  } catch {
    // ignore — file may already exist and be writable
  }
}
```
Import `closeSync` from `node:fs`. Remove the duplicate `chmodSync` at line 41.

Also: `emit` calls `chmodSync(logFile, 0o600)` on every single write (logger.ts:58). This is a syscall per log line.
**Fix**: Call `chmodSync` once in `ensureLogFile`; remove it from `emit`.

### 1.2 `downloader.ts` — Filename extension logic dead branch
**[BUG]** Lines 103–112: the `else if` branch at line 110 checks `extname(destPath) === ""` — but this condition is the **same** as the outer `if` on line 103 (`!extname(destPath)`). The branch is unreachable/redundant and the `finalPath = destPath` assignment has no effect.

**Fix**: Remove the dead `else if` branch entirely:
```ts
if (extractedName && !extname(destPath)) {
  const ext = extname(extractedName);
  finalPath = ext ? destPath + ext : join(dirname(destPath), extractedName);
}
```

### 1.3 `courses.ts` — Exhausted-redirect fallback re-requests
**[BUG]** `fetchWithRedirects` (courses.ts:121–123): after exhausting all redirect hops, it issues **one more** `request()` call using `currentUrl` (which is the last redirect target). This means on a 5-hop chain the function makes 7 requests (6 hops + 1 fallback). The fallback also ignores its own body if it gets another redirect.

**Fix**: Return the response from the last loop iteration instead of making an extra request. Store the last response body in a variable before `body.dump()`.

```ts
async function fetchWithRedirects(...): Promise<...> {
  const { request } = await import("undici");
  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { statusCode, headers: resHeaders, body } = await request(currentUrl, { method: "GET", headers });
    if (statusCode >= 300 && statusCode < 400) {
      const location = resHeaders["location"];
      if (!location) {
        return { statusCode, body: await body.text(), finalUrl: currentUrl };
      }
      const loc = Array.isArray(location) ? location[0]! : location;
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).toString();
      await body.dump();
      continue;
    }
    return { statusCode, body: await body.text(), finalUrl: currentUrl };
  }
  throw new Error(`Too many redirects fetching ${url}`);
}
```

### 1.4 `state.ts` — `migrateStatePaths` returns state but never mutates `anyChanged`
**[BUG]** `anyChanged` (state.ts:84) is set to `true` when a path is updated, but is never used — the function always returns `state` regardless of whether anything changed. The caller in `scrape.ts` checks `if (state !== rawState)` to decide whether to save; because `migrateStatePaths` always returns the same `state` object (mutated in place), this check is always `false` and the migrated state is **never saved**.

**Fix**: Return a flag or a distinct object copy so the caller can detect changes:
```ts
export function migrateStatePaths(
  state: State,
  outputDir: string,
  courseShortPaths: Map<string, { semesterDir: string; shortName: string }>,
): { state: State; changed: boolean } {
  // ... existing logic ...
  return { state, changed: anyChanged };
}
```
Update the caller in `scrape.ts`:
```ts
const { state, changed } = migrateStatePaths(rawState as State, outputDir, courseShortPathsStr);
if (changed) await stateManager.save({ courses: state.courses });
```

### 1.5 `http/client.ts` — 403 logged to `process.stderr` bypassing logger
**[BUG]** When `handleErrors: true` and status is 403, the client writes directly to `process.stderr` (client.ts:126). This bypasses the logger's credential-redaction pipeline — if the URL contains a session token, it will be printed in plaintext.

**Fix**: Replace with `options.logger?.warn(...)` or `logger?.debug(...)`. If no logger is available, either suppress the message entirely or use a safe fallback.

### 1.6 `http/client.ts` — 5xx retry via `process.stderr` bypassing logger
**[BUG]** Same issue at client.ts:139 — 5xx retry messages bypass the logger. Fix identically.

### 1.7 `session.ts` — `Object.assign` error antipattern
**[BUG]** `validateOrRefreshSession` (session.ts:114–117) throws an error via `Object.assign(new Error(...), { exitCode: ... })`. This produces an untyped `Error & { exitCode: number }` that does not survive instanceof checks and has no named class for catch blocks.

**Fix**: Define a proper `AuthError` class in `auth/prompt.ts` (one already exists there — reuse it) with an `exitCode` field. Throw `new AuthError("...", EXIT_CODES.AUTH_ERROR)`.

---

## PASS 2 — Security Hardening

### 2.1 `downloader.ts` — Path traversal via Content-Disposition filename
**[SEC]** `extractFilename` (downloader.ts:45–68) returns the raw decoded filename from `Content-Disposition` without checking for `../` sequences. A malicious server could serve `Content-Disposition: attachment; filename="../../../../.zshrc"` and overwrite arbitrary files.

**Fix**: After extracting the filename, pass it through `sanitiseFilename` (from `fs/sanitise.ts`) which already handles illegal characters and truncation. Also add an explicit check:
```ts
if (extracted.includes("..") || extracted.startsWith("/")) {
  return basename(extracted); // strip any path component
}
```

### 2.2 `config.ts` — Constructor calls sync FS operation
**[SEC]** The `ConfigManager` constructor calls `this.ensureDir()` synchronously, but `ensureDir` as currently structured is sync-ish through `mkdirSync`. This is fine, but the double `chmodSync` pattern (config.ts:47–48) calls `chmodSync` twice on the same file. Remove the redundant call.

### 2.3 `session.ts` — Session file written to predictable path without `O_EXCL`
**[SEC]** `~/.config/moodle-scraper/session.json` is a well-known path. If an attacker can pre-create a symlink there, a write will follow the symlink. This is a TOCTOU risk.

**Fix** (hardening, not critical): When writing the session file, check that the path is not a symlink using `lstatSync` before writing. If it is a symlink, refuse and warn.

### 2.4 `courses.ts`/`downloader.ts` — No HTTPS check on redirected URLs
**[SEC]** `fetchWithRedirects` (courses.ts) and the redirect loop in `downloader.ts` follow redirects to any URL including `http://`. The `httpClient` enforces HTTPS via `assertHttps`, but `fetchWithRedirects` uses raw `undici.request()` directly, bypassing this check.

**Fix**: Add `assertHttps` (or an equivalent inline check) to `fetchWithRedirects` and to the redirect loop in `downloader.ts` before following each hop.

---

## PASS 3 — Eliminate Code Duplication

### 3.1 Extract `extractCookies()` to `src/http/cookies.ts`
**[DUP]** The `extractCookies` function (extracts the `name=value` part of `Set-Cookie` headers) is duplicated in:
- `src/auth/prompt.ts` (~line 43)
- `src/auth/session.ts` (line 29–34)
- `src/http/client.ts` (lines 151–154 inline)

**Fix**: Create `src/http/cookies.ts`:
```ts
/** Extract name=value pairs from Set-Cookie headers into a single cookie string. */
export function extractCookies(headers: Record<string, string | string[]>): string {
  const raw = headers["set-cookie"];
  if (!raw) return "";
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => c.split(";")[0]).join("; ");
}
```
Update all three callers to import from `src/http/cookies.js`.

### 3.2 Extract `fetchWithRedirects()` to `src/http/fetch-with-redirects.ts`
**[DUP]** Redirect-following logic is implemented independently in:
- `src/scraper/courses.ts` (lines 92–124) — returns `{ statusCode, body: string, finalUrl }`
- `src/scraper/downloader.ts` (lines 81–131 inside `downloadFile`) — fetches binary with progress

These are different enough in purpose (text vs. binary stream) that they cannot be fully unified, but the **redirect loop itself** (location resolution, body.dump) is identical.

**Fix**: Extract just the redirect-resolution helper:
```ts
// src/http/fetch-with-redirects.ts
export async function resolveRedirects(
  url: string,
  headers: Record<string, string>,
  maxRedirects = 5,
): Promise<{ finalUrl: string; statusCode: number; headers: Record<string, string | string[]>; body: BodyReadable }> {
  // ... resolve redirects, return final response without reading body
}
```
Use this in both `courses.ts` and `downloader.ts` for the redirect phase, then each caller handles its own body (text vs. stream).

### 3.3 Extract `buildSectionPath()` to `src/fs/output.ts`
**[DUP]** The section directory path construction (`join(outputDir, [semesterDir,] safeCourse, safeSection)`) appears in:
- `src/scraper/dispatch.ts` (lines 52–54)
- `src/commands/scrape.ts` (line 224) — `buildOutputPath` call

**Fix**: `buildOutputPath` in `output.ts` already does this. Audit `dispatch.ts` to use `buildOutputPath` or a shared helper instead of reimplementing the path logic.

### 3.4 Extract `resourceId` generation to `src/scraper/resource-id.ts`
**[DUP]** The expression `` activity.resourceId ?? `${tree.courseId}-${section.sectionId}-${activity.activityName}` `` appears in:
- `scrape.ts` lines 151, 189, 344

**Fix**: Extract to a small utility:
```ts
// src/scraper/resource-id.ts
export function getResourceId(activity: Activity, courseId: number, sectionId: string): string {
  return activity.resourceId ?? `${courseId}-${sectionId}-${activity.activityName}`;
}
```

---

## PASS 4 — Type Safety

### 4.1 `scraper/dispatch.ts` — Strategy as string literals → use the existing type alias
**[TYPE]** `DownloadStrategy` is already defined as a union type at dispatch.ts:7. Good. But in `scrape.ts` the strategy is compared with raw string literals (`=== "binary"`, `=== "url-txt"`, etc.) with no compile-time connection to the type alias.

**Fix**: Make the strategy comparison exhaustive and type-safe:
```ts
import type { DownloadStrategy } from "../scraper/dispatch.js";

function isSpecialStrategy(s: DownloadStrategy): s is Exclude<DownloadStrategy, "binary"> {
  return s !== "binary";
}
```

### 4.2 `scraper/courses.ts` — `Activity.url` typed as `string` but can be empty
**[TYPE]** `Activity.url` (courses.ts:11) is typed as `string` but the `parseActivityFromElement` function can return `url: ""` for labels and inaccessible items. Callers must check `activity.url` before using it, but the type doesn't enforce this.

**Fix**: Change to `url: string` → split into `url?: string` (optional) or use a discriminated union:
```ts
// Option A (simpler): mark url as optional
export interface Activity {
  ...
  url?: string;
  ...
}
```
This will surface all the places that assume `url` is always defined — fix each with proper guards.

### 4.3 `scraper/dispatch.ts` — `url: activity.url` for label items is always empty
**[TYPE]** `buildDownloadPlan` (dispatch.ts:80) sets `url: activity.url` in the returned `DownloadPlanItem` even for `label-md` and `description-md` strategies where `activity.url` is `""` or undefined. The `DownloadPlanItem.url` field thus misleads callers into thinking they have a valid URL.

**Fix**: Make `DownloadPlanItem.url` optional:
```ts
export interface DownloadPlanItem {
  ...
  url?: string;
  ...
}
```

### 4.4 `config.ts` — `get()` return type is over-broad
**[TYPE]** `ConfigManager.get(key)` returns `(typeof DEFAULTS)[K] | undefined`. Callers in `scrape.ts` then cast the result: `(await config.get("maxConcurrentDownloads")) as number | undefined`. The cast is necessary because `DEFAULTS` uses `string | number | boolean` values.

**Fix**: Use typed overloads to return the correct type per key without casting:
```ts
get<K extends keyof typeof DEFAULTS>(key: K): Promise<typeof DEFAULTS[K] | undefined>;
```

### 4.5 `logger.ts` — `redact: []` default is misleading
**[TYPE]** `createLogger` accepts `redact: string[]` but callers almost always want `redact: [password, username]`. The type doesn't prevent accidentally passing an empty array and forgetting to add secrets.

**Fix**: No type change needed, but add a runtime assertion in `assertNoSecrets` and ensure all callers that have access to credentials pass them into `redact`. Consider renaming the option to `secrets` to make its purpose clearer.

---

## PASS 5 — Code Quality & Clarity

### 5.1 `scrape.ts` — Split the 393-line monolith
**[QUAL]** `runScrape` does too many things in one function. Extract into focused helpers:

- **`buildActivityIndex`** — builds `activityByResourceId` map from expanded trees (lines 181–193)
- **`expandFolders`** — replaces folder activities with their files (lines 107–136)
- **`separateDownloadItems`** — splits the download plan into binary vs special items (lines 199–257)
- **`reconstructState`** — builds the updated state object after downloads (lines 329–364)

Each helper should be a pure function taking explicit parameters and returning a typed result. `runScrape` becomes a ~100-line orchestration function.

### 5.2 `http/rate-limiter.ts` — Jitter calculation asymmetry
**[QUAL]** The jitter calculation (rate-limiter.ts:26):
```ts
Math.random() * this.jitterMs * 2 - this.jitterMs
```
This produces values in `[-jitterMs, jitterMs]`. The intent is correct (symmetric jitter), but the formula reads awkwardly. Rewrite as:
```ts
(Math.random() - 0.5) * 2 * this.jitterMs
```
Same result, clearer intent.

### 5.3 `auth/keychain.ts` — Repeated `assertMacOS()` calls
**[QUAL]** Every public method in `KeychainAdapter` calls `assertMacOS()` (keychain.ts:28–31). This is valid but adds boilerplate. Add a private wrapper:
```ts
private async assertedOp<T>(fn: () => Promise<T>): Promise<T> {
  this.assertMacOS();
  return fn();
}
```
Then each public method: `return this.assertedOp(() => keytar.setPassword(...))`.

### 5.4 `auth/prompt.ts` — Login success detection is undocumented
**[QUAL]** Lines 102–124 implement a two-step login flow (POST → testsession redirect → GET /my/) that's not immediately obvious. Add a block comment explaining the Moodle auth flow.

### 5.5 `courses.ts` — `parseActivityFromElement` uses `process.stderr` instead of logger
**[QUAL]** `parseActivityFromElement` (courses.ts:259, 313) writes warnings directly to `process.stderr`. This bypasses the logger and credential-redaction pipeline.

**Fix**: Thread the logger through to this function (add optional `logger?: Logger` parameter to `parseActivityFromElement` and callers).

### 5.6 `scrape.ts` — `bar` variable accessed in closure before initialization
**[QUAL]** The `onComplete` callback (scrape.ts:242) references `bar` via closure:
```ts
onComplete: (fp) => { if (bar) bar.increment(1, ...); },
```
But `bar` is declared and assigned **after** this object is created (lines 261–271). This works at runtime because by the time `onComplete` fires, `bar` has been assigned — but it's confusing and fragile.

**Fix**: Initialize `bar` before building `binaryItems`, or pass `bar` as a parameter to the item builder function instead of relying on closure mutation.

### 5.7 `commands/status.ts` — No disk check for existing state files
**[QUAL]** `runStatus` reports file counts from state but never verifies the files exist on disk. A user who manually deleted downloaded files would see incorrect counts.

**Fix**: When `--issues` flag is active, stat each `localPath` and report missing files alongside orphaned records.

### 5.8 `commands/wizard.ts` — `~` not expanded in output directory
**[QUAL]** `runWizard` (wizard.ts:41–44) falls back to `process.env.HOME ?? "~"` when constructing the default output path. The literal `~` is not expanded by Node and will create a folder named `~` in the working directory.

**Fix**: Use `homedir()` from `node:os` (already used elsewhere) as the fallback instead of `"~"`.

### 5.9 `http/client.ts` — `readPkg()` with brittle path resolution
**[QUAL]** `readPkg()` (client.ts:11–16) tries two relative paths to find `package.json`. This is a smell — the package version should be injected at build time, not discovered at runtime.

**Fix**: Use `tsup` to inject the version as a constant during build:
```ts
// vite/tsup define
const VERSION = process.env.npm_package_version ?? "0.0.0";
```
Or use `import.meta.resolve` if available. Remove the `readPkg()` function.

### 5.10 `http/retry.ts` — `shouldRetry` callback receives `unknown`
**[QUAL]** The `shouldRetry` parameter is typed as `((err: unknown) => boolean) | undefined` (retry.ts). In practice every caller passes `isNetworkError` from `downloader.ts` which already handles `unknown`. This is fine, but the type should be documented:
```ts
/** Called with the thrown error value; return true to retry. */
shouldRetry?: (err: unknown) => boolean;
```

### 5.11 `config.ts` — Silent JSON parse error on corrupt state
**[QUAL]** `ConfigManager.read()` returns `{}` on JSON parse error (config.ts:36–43) with no warning. This silently ignores a corrupted config file.

**Fix**: Log a warning to `process.stderr` before returning `{}`:
```ts
} catch {
  process.stderr.write(`Warning: config file at ${this.configPath} is corrupt — using defaults.\n`);
  return {};
}
```

### 5.12 `scraper/course-naming.ts` — MODULE_SEMESTER map undocumented
**[QUAL]** The `MODULE_SEMESTER` map hardcodes HWR WI semester assignments (course-naming.ts:16–28). There is no comment explaining what the keys represent or where they come from.

**Fix**: Add a block comment above the map:
```ts
/**
 * Maps HWR WI module code prefixes to semester directory names.
 * Pattern: WIxyzN where x=year, y=term, z=sequence number.
 * Source: HWR Berlin WI curriculum structure (2024 intake).
 */
```

---

## PASS 6 — Test Coverage

### 6.1 Add regression tests for Phase 5 bugs

Each bug that was fixed in Phase 5 should have a regression test to prevent recurrence:

| Bug Fixed | Test Location | Test Description |
|-----------|--------------|------------------|
| Redirect following in fetchContentTree | `tests/unit/scrape-courses.test.ts` | Mock 302 → 200 redirect chain; assert final HTML parsed correctly |
| Redirect following in downloadFile | `tests/unit/scrape-downloader.test.ts` | Mock 302 → 200; assert file downloaded from redirected URL |
| accesshide span pollution | `tests/unit/scrape-courses.test.ts` | Activity with `<span class="accesshide">Datei</span>` in link; assert name excludes "Datei" |
| State save off-by-one (binaryItems) | `tests/unit/sync-state.test.ts` | Mock queue run returning finalPaths; assert state saved with correct paths |
| migrateStatePaths not saving | `tests/unit/sync-state.test.ts` | Assert `changed` flag true when migration happens; assert save called |

### 6.2 Add tests for uncovered code paths

- `tests/unit/http-client.test.ts` — Test `mergeCookies()` function (currently not directly tested)
- `tests/unit/http-client.test.ts` — Test HTTPS enforcement (`InsecureURLError` thrown for `http://` URLs)
- `tests/unit/http-client.test.ts` — Test 429 handling with `Retry-After` header
- `tests/unit/http-client.test.ts` — Test maintenance mode detection (`site-maintenance` in body)
- `tests/unit/scrape-downloader.test.ts` — Test `extractFilename` with Content-Disposition `filename*=` (RFC 5987 extended syntax)
- `tests/unit/scrape-downloader.test.ts` — Test partial download recovery (network error mid-stream)
- `tests/unit/auth-session.test.ts` — Test cookie extraction utility function directly
- `tests/unit/fs-output.test.ts` — Test `checkDiskSpace` with mocked `df` output

### 6.3 Strengthen existing test assertions

- `tests/unit/scrape-dispatch.test.ts`: Add assertion that `description-md` sidecar is generated alongside binary items that have a `description` field
- `tests/unit/scrape-course-naming.test.ts`: Add test for course name with no WI code (falls through all patterns → `Sonstiges`)
- `tests/unit/sync-incremental.test.ts`: Add test for `checkFiles: true` where localPath file doesn't exist on disk
- `tests/integration/full-scrape.test.ts`: Assert that the state file is written with correct `localPath` values (not just `downloadedCount > 0`)

---

## PASS 7 — Documentation

### 7.1 Add JSDoc to complex functions

These functions are complex enough to warrant inline documentation:

```
src/auth/prompt.ts      promptAndAuthenticate()   — explain the two-step Moodle login flow
src/auth/session.ts     validateOrRefreshSession() — explain the session check + re-auth logic
src/scraper/courses.ts  parseContentTree()         — explain the three-fallback section name strategy
src/scraper/courses.ts  parseActivityFromElement() — explain what Moodle HTML structure is expected
src/sync/state.ts       migrateStatePaths()        — the inline JSDoc is good; confirm it's accurate after bug fix
src/scraper/dispatch.ts buildDownloadPlan()        — explain each strategy and when it's chosen
src/commands/scrape.ts  runScrape()                — document the orchestration flow steps
```

### 7.2 Fix inaccurate comments

- `logger.ts:37` — Remove comment "fd closed automatically by GC" (incorrect; fix closes fd explicitly)
- `downloader.ts:110` — The dead `else if` comment should be removed along with the code
- `state.ts:84` — Comment on `anyChanged` needs updating after the return-type fix

### 7.3 Update `FEATURE_TIMELINE.md` acceptance criteria checkboxes

All 22 steps are implemented but the Acceptance Criteria checkboxes (`[ ]`) are all unchecked. Mark them `[x]` for completed steps. This makes the timeline an accurate historical record rather than a misleading backlog.

### 7.4 Update `README.md`

Add a **Troubleshooting** section covering the most common first-run issues:
- `keytar` failing to compile (Xcode Command Line Tools required)
- "No courses found" (courseSearch config not set)
- "0 to download" (all files already up to date — use `--force` to re-download)
- macOS Keychain dialog appears on first run (expected — grant "Always Allow")

---

## PASS 8 — Performance

### 8.1 `downloader.ts` — Stream large files instead of buffering
**[BUG/PERF]** `downloadFile` buffers the entire response into `chunks: Buffer[]` (downloader.ts:118–126) then calls `Buffer.concat(chunks)` before writing. For large files (lecture recordings, large PDFs) this holds the full file in memory.

**Fix**: Use `atomicWrite` with a `Buffer` is fine for typical Moodle files (<50 MB). For future-proofing, note this in a comment and add a max-size guard:
```ts
// Note: entire file is buffered in memory. Acceptable for Moodle files (typically <50 MB).
// If Moodle adds video streaming support, switch to a pipe-based atomic write.
```

### 8.2 `courses.ts` — `activityOpenRe` regex restarted per match
The `activityOpenRe` regex (courses.ts:219) is declared inside the loop body. In JavaScript, inline regex literals inside loops are reused (they're not recreated), so this is fine. But declare it outside the function for clarity.

### 8.3 `state.ts` — State not indexed by courseId
`computeSyncPlan` and `runScrape` both walk `state.courses` as a plain `Record<string, CourseState>`. Access is O(1) already (hash map). No action needed.

---

## PASS 9 — Style & Naming Consistency

### 9.1 British vs American spelling in function names
- `sanitiseFilename` (British) in `fs/sanitise.ts`
- `createLogger` (American style) in `logger.ts`

This is a minor inconsistency. The British `sanitise` spelling was intentional (see git history). No change needed — document this choice in a brief comment at the top of `fs/sanitise.ts`:
```ts
// UK English spelling used throughout this file (sanitise, not sanitize).
```

### 9.2 Inconsistent `process.stderr.write` vs `logger.warn`
Audit all files for raw `process.stderr.write(...)` calls. Each one should be either:
- Replaced with `logger.warn(...)` or `logger.error(...)` if a logger is in scope
- Left as-is with a comment explaining why the logger is unavailable (e.g., before the logger is created in early startup)

Current raw `process.stderr.write` calls found:
- `session.ts:107` — "Session expired, re-authenticating…" → use `logger?.warn(...)` (logger is in scope)
- `courses.ts:259` — parse warning → thread logger through to `parseActivityFromElement`
- `courses.ts:313` — same
- `http/client.ts:126` — 403 warning → use `options.logger?.warn(...)`
- `http/client.ts:139` — 5xx retry warning → same
- `state.ts:47` — "state file corrupt" → this is pre-logger startup; write is correct, add comment

### 9.3 `ScrapeOptions` interface — `baseUrl` should have a default documented
`ScrapeOptions.baseUrl` (scrape.ts:24) is optional but the default `"https://moodle.hwr-berlin.de"` is hardcoded inside `runScrape`. Document the default in the interface:
```ts
/** Moodle base URL. Defaults to "https://moodle.hwr-berlin.de". */
baseUrl?: string;
```

---

## PASS 10 — Agents & Workflow Files

### 10.1 `agents/developer.md` — Add note about `getResourceId` utility
After extracting `src/scraper/resource-id.ts` (Pass 3.4), update `agents/developer.md` to reference this utility so future developers don't re-introduce the duplication.

### 10.2 `agents/html-analyzer.md` — Verify instructions are accurate
Read through `agents/html-analyzer.md` and ensure the instructions correctly describe the current HTML parsing approach (post-Phase-5 fixes: `parseOnetopicTabs`, `stripAccessHide`, `activity-altcontent`).

### 10.3 `.claude/settings.json` — Verify hooks still work
After refactoring module structure (Pass 3), re-run the doc-updater hook manually to confirm it still triggers correctly and updates the right files.

---

## Execution Order

| Priority | Pass | Effort | Risk |
|----------|------|--------|------|
| 1 | Pass 1 (Bug Fixes) | Low–Medium | Low |
| 2 | Pass 2 (Security) | Low | Low |
| 3 | Pass 3 (Duplication) | Medium | Medium (refactor) |
| 4 | Pass 6 (Tests) — regression tests only | Medium | Low |
| 5 | Pass 4 (Types) | Medium | Medium |
| 6 | Pass 5 (Quality) | Medium | Low |
| 7 | Pass 6 (Tests) — new coverage | Medium | Low |
| 8 | Pass 7 (Docs) | Low | None |
| 9 | Pass 8 (Performance) | Low | Low |
| 10 | Pass 9 (Style) | Low | None |
| 11 | Pass 10 (Agents) | Low | None |

**After each Pass**: run `npm test` to verify all 225 tests still pass. Fix any regressions before proceeding.

---

## Definition of Done

- [ ] All 225 existing tests pass
- [ ] All new regression tests pass
- [ ] No `process.stderr.write` calls that bypass credential redaction
- [ ] No dead code branches
- [ ] No file descriptor leaks
- [ ] `migrateStatePaths` bug fixed and covered by test
- [ ] `extractCookies` extracted to one location
- [ ] `fetchWithRedirects` bug fixed (no extra request on redirect exhaustion)
- [ ] `scrape.ts` broken into focused helper functions (<150 lines in `runScrape`)
- [ ] All complex functions have JSDoc
- [ ] `FEATURE_TIMELINE.md` acceptance criteria all checked
- [ ] `README.md` has Troubleshooting section
- [ ] `doc-updater` agent run and docs up to date
