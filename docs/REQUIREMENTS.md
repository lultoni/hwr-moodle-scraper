# Requirements — HWR Moodle Scraper

- **Status**: DRAFT
- **Last updated**: 2026-03-26
- **Completeness audit**: PENDING

---

## Actors

| Actor | Description |
|-------|-------------|
| **User** | Student running the CLI on macOS |
| **Moodle Server** | HWR Berlin Moodle instance (HTTPS) |
| **Local Filesystem** | macOS filesystem where output is written |
| **OS Credential Store** | macOS Keychain |
| **CLI** | The program itself |

---

## Requirement Categories

| Prefix | Category |
|--------|----------|
| `REQ-AUTH-*` | Authentication & session management |
| `REQ-SCRAPE-*` | Content discovery and download |
| `REQ-SYNC-*` | Incremental sync and change detection |
| `REQ-FS-*` | Filesystem output structure |
| `REQ-CLI-*` | CLI interface and UX |
| `REQ-SEC-*` | Security constraints |
| `REQ-ERR-*` | Error handling |

---


---

## Authentication & Session Management

### REQ-AUTH-001: First-run credential prompt
- **Type**: UX
- **Priority**: Must-Have
- **Description**: On the very first execution of the scraper, when no credentials for service "moodle-scraper" exist in the macOS Keychain, the CLI must interactively prompt the user for their Moodle username (characters echoed to the terminal) and then their password (characters suppressed/masked so they are not visible in the terminal). Credentials must not be written to the Keychain until a login attempt with those credentials succeeds.
- **Trigger**: The user runs any scrape command (or `auth set`) and no Keychain entry with service name "moodle-scraper" is found.
- **Input**:
  - Username: free-text string entered interactively at the terminal prompt (visible input)
  - Password: free-text string entered interactively at the terminal prompt (hidden/masked input, no echo)
- **Output / Outcome**: After successful login verification, the credentials are stored in the macOS Keychain under service "moodle-scraper" and the scrape (or auth) operation proceeds. The terminal displays the username prompt label and a masked password prompt label; no credential values are ever printed to stdout or stderr.
- **Error Conditions**:
  - Empty username submitted: print "Username must not be empty." to stderr, re-prompt without advancing to password
  - Empty password submitted: print "Password must not be empty." to stderr, re-prompt for password only
  - Login verification fails (wrong credentials): print "Login failed: incorrect username or password." to stderr; do NOT store credentials in Keychain; exit with code 1
  - Network failure during verification: print "Login failed: network error — <error detail>." to stderr; do NOT store credentials; exit with code 1
- **Acceptance Criteria**:
  ```gherkin
  Scenario: First run with no stored credentials — successful login
    Given no Keychain entry exists for service "moodle-scraper"
    And the user runs a scrape command
    When the CLI prompts for username and the user enters a valid username
    And the CLI prompts for password and the user enters the correct password
    And the login request to Moodle succeeds
    Then credentials are stored in the Keychain under service "moodle-scraper"
    And the scrape operation continues without further prompting

  Scenario: First run — empty username rejected
    Given no Keychain entry exists for service "moodle-scraper"
    And the user runs a scrape command
    When the CLI prompts for username and the user submits an empty string
    Then the CLI prints "Username must not be empty." to stderr
    And the CLI re-prompts for username without advancing to the password prompt

  Scenario: First run — empty password rejected
    Given no Keychain entry exists for service "moodle-scraper"
    And the user enters a valid non-empty username
    When the CLI prompts for password and the user submits an empty string
    Then the CLI prints "Password must not be empty." to stderr
    And the CLI re-prompts for password only

  Scenario: First run — wrong credentials
    Given no Keychain entry exists for service "moodle-scraper"
    And the user enters a username and a wrong password
    When the login verification request returns a Moodle HTML error response
    Then the CLI prints "Login failed: incorrect username or password." to stderr
    And no entry is written to the Keychain
    And the process exits with code 1
  ```
- **Rules**:
  - RULE-AUTH-001-A: Password input MUST use a terminal masking mechanism (e.g. `getpass` or equivalent) that suppresses all character echo for the duration of password entry.
  - RULE-AUTH-001-B: Credentials MUST NOT be written to the Keychain before a successful HTTP 200 response is received from the Moodle session endpoint (i.e. no redirect to the login page).
  - RULE-AUTH-001-C: Neither the username nor the password may appear in any log output, error message, or stack trace at any log level.
- **Dependencies**: REQ-AUTH-002, REQ-AUTH-003

---

### REQ-AUTH-002: Credential storage in macOS Keychain
- **Type**: Security
- **Priority**: Must-Have
- **Description**: All Moodle credentials (username and password) must be stored exclusively in the macOS Keychain using the native Keychain API. The Keychain entry must use the fixed service name `"moodle-scraper"` and the account field must be set to the user's Moodle username. There must be no plaintext fallback storage mechanism (no dotfiles, no environment variable persistence, no config files containing passwords) under any circumstances.
- **Trigger**: A successful login verification completes and credentials are ready to be persisted (see REQ-AUTH-001, REQ-AUTH-007).
- **Input**:
  - Service name: the fixed string `"moodle-scraper"`
  - Account: the Moodle username string as entered by the user
  - Secret: the Moodle password string as entered by the user
- **Output / Outcome**: A Keychain item exists with service `"moodle-scraper"` and account equal to the username, accessible to the scraper process. No file on disk contains the password in any form (plaintext, base64, or any reversible encoding).
- **Error Conditions**:
  - Keychain write fails (e.g. permission denied, Keychain locked): print "Error: could not save credentials to Keychain — <OS error message>." to stderr and exit with code 1; do NOT fall back to any file-based storage
  - Keychain read fails at startup: print "Error: could not read credentials from Keychain — <OS error message>." to stderr and exit with code 1
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Successful credential storage
    Given login verification has succeeded
    When the scraper stores credentials
    Then a Keychain item with service "moodle-scraper" and account equal to the username exists
    And no file in the filesystem contains the password string

  Scenario: Keychain write failure — no plaintext fallback
    Given login verification has succeeded
    And the Keychain is locked or returns a permission error
    When the scraper attempts to store credentials
    Then the CLI prints "Error: could not save credentials to Keychain — <OS error message>." to stderr
    And no file is created containing the password
    And the process exits with code 1

  Scenario: Keychain read failure at startup
    Given a scrape command is invoked
    And the Keychain read operation returns an OS error
    When the scraper attempts to retrieve credentials
    Then the CLI prints "Error: could not read credentials from Keychain — <OS error message>." to stderr
    And the process exits with code 1
  ```
- **Rules**:
  - RULE-AUTH-002-A: The Keychain service name MUST be the fixed string `"moodle-scraper"` in all read and write operations; it must never be derived from user input or environment variables.
  - RULE-AUTH-002-B: The implementation MUST NOT provide any code path that writes the password to a file, environment variable, or any medium other than the macOS Keychain.
  - RULE-AUTH-002-C: If the Keychain API is unavailable (e.g. non-macOS environment), the process MUST exit with a clear error message stating the platform requirement; it must not silently degrade.
- **Dependencies**: REQ-AUTH-001

---

### REQ-AUTH-003: Session cookie acquisition
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: After successful credential verification, the scraper must capture the HTTP session cookies returned by Moodle's login endpoint and persist them to the file `~/.config/moodle-scraper/session.json`. The session file must be created with UNIX file permissions `0600` (owner read/write only, no group or other access). The session file must contain the cookies in a structured, machine-readable JSON format sufficient to reconstruct an authenticated HTTP session.
- **Trigger**: A successful login HTTP response is received from the Moodle login endpoint (HTTP 303/200 redirect chain completes without landing on the login page).
- **Input**:
  - HTTP response cookies from the Moodle login endpoint (e.g. `MoodleSession` cookie and any additional session cookies set by the server)
  - Target directory path: `~/.config/moodle-scraper/`
- **Output / Outcome**: The file `~/.config/moodle-scraper/session.json` exists, is readable only by the owning OS user (permissions `0600`), and contains a JSON representation of all session cookies including at minimum: cookie name, value, domain, path, and expiry (if set by the server).
- **Error Conditions**:
  - Directory `~/.config/moodle-scraper/` does not exist: create it with permissions `0700` before writing; if creation fails, print "Error: could not create config directory <path> — <OS error>." to stderr and exit with code 1
  - File write fails (e.g. disk full, permission denied): print "Error: could not write session file <path> — <OS error>." to stderr and exit with code 1
  - Setting file permissions to `0600` fails: print "Error: could not set permissions on session file <path> — <OS error>." to stderr and exit with code 1; remove the partially-written file
  - No session cookies received in login response: print "Error: login appeared to succeed but no session cookies were returned." to stderr and exit with code 1
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Successful session cookie persistence
    Given login verification has succeeded and Moodle has returned session cookies
    When the scraper writes the session file
    Then the file ~/.config/moodle-scraper/session.json exists
    And the file permissions are exactly 0600
    And the file contains valid JSON with at least the MoodleSession cookie name and value

  Scenario: Config directory does not exist
    Given ~/.config/moodle-scraper/ does not exist
    And login has succeeded
    When the scraper attempts to write the session file
    Then the directory is created with permissions 0700
    And the session file is written with permissions 0600

  Scenario: File write failure
    Given the filesystem returns a write error for ~/.config/moodle-scraper/session.json
    When the scraper attempts to persist session cookies
    Then the CLI prints "Error: could not write session file ~/.config/moodle-scraper/session.json — <OS error>." to stderr
    And the process exits with code 1
  ```
- **Rules**:
  - RULE-AUTH-003-A: The session file MUST be created with permissions `0600`; if the OS umask would result in broader permissions, the implementation must explicitly `chmod` the file after creation.
  - RULE-AUTH-003-B: The config directory MUST be created with permissions `0700` if it does not exist.
  - RULE-AUTH-003-C: The session file MUST be valid JSON. It MUST NOT be a pickled, binary, or non-standard format.
  - RULE-AUTH-003-D: The session file MUST NOT contain the user's Moodle password.
- **Dependencies**: REQ-AUTH-001, REQ-AUTH-002

---

### REQ-AUTH-004: Session validation before scrape
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: Before initiating any scrape operation, the scraper must validate that the persisted session is still active by sending a single lightweight HTTP GET request to the Moodle dashboard URL. If the response is an HTTP redirect (3xx) whose `Location` header points to the Moodle login page, the session is considered expired and re-authentication must be triggered. If the response is HTTP 200 with non-login-page content, the session is considered valid and the scrape proceeds.
- **Trigger**: Any scrape command is invoked and a session file (`~/.config/moodle-scraper/session.json`) exists.
- **Input**:
  - Session cookies from `~/.config/moodle-scraper/session.json`
  - Moodle dashboard URL (e.g. `https://<moodle-host>/my/`)
- **Output / Outcome**: If the session is valid, the scrape operation starts. If the session is invalid, REQ-AUTH-005 re-authentication flow is triggered. A validation check must complete within 5 seconds; if it times out, the session is treated as invalid.
- **Error Conditions**:
  - Session file does not exist: skip validation and proceed directly to first-run credential prompt (REQ-AUTH-001)
  - Session file exists but is malformed JSON: print "Warning: session file is corrupted, re-authenticating." to stderr; delete the file and trigger first-run credential prompt
  - Network timeout (>5 s) on validation request: treat as invalid session; trigger re-authentication via REQ-AUTH-005
  - Network error (non-timeout) on validation request: print "Error: could not reach Moodle server — <error detail>." to stderr and exit with code 1
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Valid session — scrape proceeds
    Given ~/.config/moodle-scraper/session.json exists and contains valid cookies
    And the Moodle dashboard responds with HTTP 200
    When the user runs a scrape command
    Then the scraper proceeds to the scrape phase without prompting for credentials

  Scenario: Expired session — re-auth triggered
    Given ~/.config/moodle-scraper/session.json exists
    And the Moodle dashboard responds with a redirect to the login page
    When the user runs a scrape command
    Then the scraper triggers re-authentication (REQ-AUTH-005)
    And does not prompt interactively if Keychain credentials are available

  Scenario: Session file absent — first-run prompt triggered
    Given ~/.config/moodle-scraper/session.json does not exist
    When the user runs a scrape command
    Then the scraper triggers the first-run credential prompt (REQ-AUTH-001)

  Scenario: Session file malformed
    Given ~/.config/moodle-scraper/session.json contains invalid JSON
    When the user runs a scrape command
    Then the CLI prints "Warning: session file is corrupted, re-authenticating." to stderr
    And the corrupted file is deleted
    And the first-run credential prompt is triggered
  ```
- **Rules**:
  - RULE-AUTH-004-A: The validation request MUST use the cookies from `session.json` and MUST NOT send credentials.
  - RULE-AUTH-004-B: The validation HTTP request MUST have a timeout of exactly 5 seconds.
  - RULE-AUTH-004-C: The redirect detection MUST check the final resolved URL of the response (after following redirects) and compare its path against the known Moodle login path (e.g. `/login/index.php`); a simple string match on the path is required.
  - RULE-AUTH-004-D: The validation request MUST NOT trigger a full page download; the implementation SHOULD send a HEAD request or limit the response body read to 0 bytes where the server supports it. If HEAD is not supported, a GET with early connection close is acceptable.
- **Dependencies**: REQ-AUTH-003, REQ-AUTH-005

---

### REQ-AUTH-005: Transparent re-authentication mid-scrape
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: If, during an active scrape operation, any HTTP response is detected to be a redirect to the Moodle login page (indicating that the session expired mid-scrape), the scraper must automatically retrieve credentials from the macOS Keychain, perform a new login to obtain fresh session cookies, persist the new cookies to `~/.config/moodle-scraper/session.json`, and resume the scrape from the exact resource that triggered the re-authentication. This automatic re-authentication must be attempted at most once per scrape session. If the single re-auth attempt fails, the scrape must abort with a descriptive error.
- **Trigger**: An HTTP response during a scrape operation resolves to a URL matching the Moodle login page path (e.g. `/login/index.php`).
- **Input**:
  - Keychain credentials for service "moodle-scraper"
  - The URL of the resource that triggered the redirect (to resume from)
- **Output / Outcome**: Fresh session cookies are obtained and written to `~/.config/moodle-scraper/session.json` (permissions `0600`). The scrape resumes from the interrupted resource and continues to completion. No interactive credential prompt is shown to the user during this process.
- **Error Conditions**:
  - Keychain credentials not found during re-auth: print "Error: session expired and no credentials found in Keychain. Run `auth set` to re-enter credentials." to stderr and exit with code 1
  - Re-authentication login request fails (wrong password): print "Error: session expired and re-authentication failed — incorrect credentials. Run `auth set` to update credentials." to stderr and exit with code 1
  - Re-authentication login request fails (network error): print "Error: session expired and re-authentication failed — network error: <detail>." to stderr and exit with code 1
  - A second redirect-to-login is detected after one successful re-auth within the same scrape session: print "Error: session expired again after re-authentication. Aborting." to stderr and exit with code 1
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Session expires mid-scrape — successful transparent re-auth
    Given a scrape is in progress
    And the scraper has performed 0 re-auth attempts this session
    When an HTTP response redirects to the Moodle login page
    Then the scraper retrieves credentials from the Keychain without prompting the user
    And performs a new login
    And writes fresh cookies to ~/.config/moodle-scraper/session.json with permissions 0600
    And resumes downloading from the resource that triggered the redirect
    And the scrape completes successfully

  Scenario: Session expires mid-scrape — no Keychain credentials
    Given a scrape is in progress
    And no Keychain entry exists for service "moodle-scraper"
    When an HTTP response redirects to the Moodle login page
    Then the CLI prints "Error: session expired and no credentials found in Keychain. Run `auth set` to re-enter credentials." to stderr
    And the process exits with code 1

  Scenario: Second session expiry after re-auth — abort
    Given a scrape is in progress
    And one re-auth attempt has already been made this session
    When a second HTTP response redirects to the Moodle login page
    Then the CLI prints "Error: session expired again after re-authentication. Aborting." to stderr
    And the process exits with code 1
  ```
- **Rules**:
  - RULE-AUTH-005-A: The re-authentication attempt counter MUST be scoped to a single scrape session and reset to zero at the start of every new scrape invocation.
  - RULE-AUTH-005-B: The maximum number of automatic re-auth attempts per scrape session is exactly 1.
  - RULE-AUTH-005-C: The re-auth flow MUST NOT display any interactive prompt; it must operate fully automatically using Keychain credentials.
  - RULE-AUTH-005-D: After re-auth, the scraper MUST retry the specific resource URL that triggered the redirect before continuing with any remaining resources.
- **Dependencies**: REQ-AUTH-002, REQ-AUTH-003, REQ-AUTH-004

---

### REQ-AUTH-006: Login failure handling
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The scraper must distinguish and report three distinct login failure modes as separate, clearly labelled error messages: (a) wrong credentials, detected by the presence of a Moodle-specific HTML error message in the login response body; (b) network failure, where the login HTTP request could not be completed due to a connection or DNS error; (c) account locked or suspended, detected by a specific Moodle HTML message in the login response body indicating the account is disabled or locked. In failure mode (a), stored Keychain credentials must NOT be deleted or overwritten.
- **Trigger**: A login HTTP POST to the Moodle login endpoint returns a response that does not result in a valid authenticated session.
- **Input**:
  - HTTP response status code from the Moodle login endpoint
  - HTTP response body HTML (for modes a and c)
  - OS-level network error detail (for mode b)
- **Output / Outcome**: One of three distinct error messages is printed to stderr, each uniquely identifying the failure mode. Process exits with code 1. Keychain credentials remain unchanged in all three cases.
- **Error Conditions**:
  - Wrong password (Moodle HTML contains an invalidlogin error element): print "Login failed: incorrect username or password." to stderr; exit with code 1; Keychain credentials unchanged
  - Network failure (connection refused, DNS failure, timeout): print "Login failed: network error — <error detail>." to stderr; exit with code 1
  - Account locked/suspended (Moodle HTML contains account suspended/locked message): print "Login failed: account is locked or suspended. Contact your Moodle administrator." to stderr; exit with code 1
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Wrong password
    Given the user attempts login
    When Moodle returns an HTML response containing the invalid-login error element
    Then the CLI prints "Login failed: incorrect username or password." to stderr
    And the existing Keychain entry for service "moodle-scraper" is not modified
    And the process exits with code 1

  Scenario: Network failure during login
    Given the user attempts login
    When the HTTP request to the Moodle login endpoint fails with a network-level error
    Then the CLI prints "Login failed: network error — <error detail>." to stderr
    And the existing Keychain entry for service "moodle-scraper" is not modified
    And the process exits with code 1

  Scenario: Account locked or suspended
    Given the user attempts login
    When Moodle returns an HTML response containing an account suspended or locked message
    Then the CLI prints "Login failed: account is locked or suspended. Contact your Moodle administrator." to stderr
    And the existing Keychain entry for service "moodle-scraper" is not modified
    And the process exits with code 1
  ```
- **Rules**:
  - RULE-AUTH-006-A: Wrong-password detection MUST be based on the presence of a known Moodle HTML element or CSS class (e.g. `loginerrors` div or equivalent) in the response body; it MUST NOT rely solely on HTTP status code.
  - RULE-AUTH-006-B: Account-locked detection MUST be based on a distinct Moodle HTML message string separate from the wrong-password message; the two cases MUST produce different output messages.
  - RULE-AUTH-006-C: Under NO login failure condition may the stored Keychain entry be deleted, overwritten, or modified.
  - RULE-AUTH-006-D: The three failure modes MUST be mutually exclusive in their error output; the implementation must check them in the order: network error → account locked → wrong password.
- **Dependencies**: REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-005

---

### REQ-AUTH-007: `auth set` command
- **Type**: UX
- **Priority**: Must-Have
- **Description**: The CLI must expose a command `auth set` that allows the user to interactively re-enter their Moodle username and password at any time. The command must prompt for username (visible input) and password (masked input), attempt a login verification, and on success update the Keychain entry (creating it if absent, overwriting it if present) and print exactly `"Credentials saved."` to stdout. On failure, the Keychain entry must not be modified.
- **Trigger**: The user executes `moodle-scraper auth set` (or equivalent CLI invocation per REQ-CLI-*).
- **Input**:
  - Username: free-text string entered interactively (visible)
  - Password: free-text string entered interactively (masked)
- **Output / Outcome**: On success: Keychain entry for service "moodle-scraper" with account = new username and secret = new password is created or updated; the string `"Credentials saved."` is printed to stdout (exactly, including the period, with no trailing whitespace or additional lines). On failure: existing Keychain entry is unchanged and an appropriate error message is printed to stderr (per REQ-AUTH-006 failure modes).
- **Error Conditions**:
  - Empty username: print "Username must not be empty." to stderr, re-prompt
  - Empty password: print "Password must not be empty." to stderr, re-prompt
  - Login verification fails (wrong password): print "Login failed: incorrect username or password." to stderr; Keychain unchanged; exit with code 1
  - Login verification fails (network error): print "Login failed: network error — <error detail>." to stderr; Keychain unchanged; exit with code 1
  - Login verification fails (account locked): print "Login failed: account is locked or suspended. Contact your Moodle administrator." to stderr; Keychain unchanged; exit with code 1
  - Keychain write fails after successful login: print "Error: could not save credentials to Keychain — <OS error>." to stderr; exit with code 1
- **Acceptance Criteria**:
  ```gherkin
  Scenario: auth set — successful update
    Given the user runs "moodle-scraper auth set"
    When the user enters a valid username and correct password
    And login verification succeeds
    Then the Keychain entry for service "moodle-scraper" is created or updated with the new credentials
    And the CLI prints exactly "Credentials saved." to stdout
    And the process exits with code 0

  Scenario: auth set — wrong password
    Given the user runs "moodle-scraper auth set"
    And the user enters a valid username but an incorrect password
    When login verification returns an invalid-login error
    Then the CLI prints "Login failed: incorrect username or password." to stderr
    And the existing Keychain entry is not modified
    And the process exits with code 1

  Scenario: auth set — empty username rejected
    Given the user runs "moodle-scraper auth set"
    When the user submits an empty username
    Then the CLI prints "Username must not be empty." to stderr
    And the CLI re-prompts for username
  ```
- **Rules**:
  - RULE-AUTH-007-A: The success message MUST be exactly `"Credentials saved."` — no extra whitespace, no ANSI colour codes, no trailing newline beyond the standard line terminator.
  - RULE-AUTH-007-B: The Keychain entry MUST NOT be updated until login verification returns a valid authenticated session (i.e. no redirect to login page).
  - RULE-AUTH-007-C: Password input MUST use terminal masking (no echo) as per RULE-AUTH-001-A.
  - RULE-AUTH-007-D: If a Keychain entry for a different username already exists, the old entry MUST be deleted and replaced with the new username/password entry; two entries for the same service MUST NOT coexist.
- **Dependencies**: REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-006

---

### REQ-AUTH-008: `auth clear` command
- **Type**: UX
- **Priority**: Must-Have
- **Description**: The CLI must expose a command `auth clear` that removes all stored authentication state: it deletes the Keychain entry for service "moodle-scraper" (if present) and deletes the session file `~/.config/moodle-scraper/session.json` (if present). The command must print an itemised list of exactly what was removed. If neither the Keychain entry nor the session file was present, the command must print a confirmation that nothing was stored.
- **Trigger**: The user executes `moodle-scraper auth clear` (or equivalent CLI invocation per REQ-CLI-*).
- **Input**: None (no user input beyond the command itself).
- **Output / Outcome**:
  - If Keychain entry was found and deleted: print `"Keychain entry removed."` to stdout
  - If session file was found and deleted: print `"Session file removed."` to stdout
  - If both were absent: print `"Nothing to clear."` to stdout
  - Each removal message is printed on its own line. Process exits with code 0 in all of the above cases.
- **Error Conditions**:
  - Keychain deletion fails (OS error): print "Error: could not remove Keychain entry — <OS error>." to stderr; continue attempting to delete the session file; exit with code 1 after all deletion attempts
  - Session file deletion fails (OS error): print "Error: could not remove session file — <OS error>." to stderr; exit with code 1
- **Acceptance Criteria**:
  ```gherkin
  Scenario: auth clear — both Keychain entry and session file present
    Given a Keychain entry for service "moodle-scraper" exists
    And ~/.config/moodle-scraper/session.json exists
    When the user runs "moodle-scraper auth clear"
    Then the Keychain entry is deleted
    And the session file is deleted
    And the CLI prints "Keychain entry removed." to stdout
    And the CLI prints "Session file removed." to stdout
    And the process exits with code 0

  Scenario: auth clear — only Keychain entry present
    Given a Keychain entry for service "moodle-scraper" exists
    And ~/.config/moodle-scraper/session.json does not exist
    When the user runs "moodle-scraper auth clear"
    Then the Keychain entry is deleted
    And the CLI prints "Keychain entry removed." to stdout
    And the process exits with code 0

  Scenario: auth clear — only session file present
    Given no Keychain entry exists for service "moodle-scraper"
    And ~/.config/moodle-scraper/session.json exists
    When the user runs "moodle-scraper auth clear"
    Then the session file is deleted
    And the CLI prints "Session file removed." to stdout
    And the process exits with code 0

  Scenario: auth clear — nothing stored
    Given no Keychain entry exists for service "moodle-scraper"
    And ~/.config/moodle-scraper/session.json does not exist
    When the user runs "moodle-scraper auth clear"
    Then the CLI prints "Nothing to clear." to stdout
    And the process exits with code 0

  Scenario: auth clear — Keychain deletion fails
    Given a Keychain entry for service "moodle-scraper" exists
    And the Keychain returns an OS error on delete
    When the user runs "moodle-scraper auth clear"
    Then the CLI prints "Error: could not remove Keychain entry — <OS error>." to stderr
    And the session file deletion is still attempted
    And the process exits with code 1
  ```
- **Rules**:
  - RULE-AUTH-008-A: The output messages MUST be exactly as specified: `"Keychain entry removed."`, `"Session file removed."`, and `"Nothing to clear."` — no extra whitespace or ANSI codes.
  - RULE-AUTH-008-B: If both deletions fail, both error messages MUST be printed (one per line to stderr) before exiting with code 1.
  - RULE-AUTH-008-C: A Keychain deletion failure MUST NOT prevent the session file deletion from being attempted; the command must always attempt both operations.
  - RULE-AUTH-008-D: The command MUST NOT prompt for confirmation before deleting; it is a non-destructive-of-user-data operation (credentials can be re-entered; no scraped content is deleted).
- **Dependencies**: REQ-AUTH-002, REQ-AUTH-003

---

## Content Discovery & Download

---

### REQ-SCRAPE-001: Enrolled Course Listing
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The scraper fetches the authenticated Moodle dashboard page and parses all courses in which the user is currently enrolled and active. For each course it extracts: the human-readable course name (string), the Moodle-internal course ID (positive integer), and the canonical course URL (absolute HTTPS URL). Archived or hidden courses that do not appear on the dashboard are not included unless explicitly visible to the authenticated user.
- **Trigger**: The scraping session starts after successful authentication (REQ-AUTH-*). This is the first scraping step of every run (full or incremental).
- **Input**: The authenticated HTTP session (cookies/token); the Moodle dashboard URL derived from the configured base URL (e.g. `https://<base>/my/`).
- **Output / Outcome**: An in-memory ordered list of course objects, each containing: `course_name` (string, non-empty), `course_id` (positive integer), `course_url` (absolute HTTPS URL string). The list preserves the order courses appear on the dashboard. The list is passed to subsequent scraping steps.
- **Error Conditions**:
  - HTTP status != 200 from dashboard URL: abort scraping session, emit fatal error `"Failed to load dashboard: HTTP <status>"`, exit with code 2.
  - Dashboard page returns zero parsed courses (e.g. empty enrollment, unexpected page structure): emit warning `"No enrolled courses found on dashboard. Verify login and enrollment."`, exit with code 0 (nothing to do).
  - A course entry is missing its `course_id` or `course_url` in the parsed HTML: skip that entry, emit warning `"Skipping malformed course entry: <course_name>"`, continue parsing remaining entries.
  - Network timeout or connection error reaching the dashboard: handled per REQ-ERR-* (retry up to 3 times with exponential backoff, then fatal error).
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Dashboard has enrolled courses
    Given the user is authenticated with a valid session
    And the Moodle dashboard is reachable at the configured base URL
    And the user is enrolled in at least one active course
    When the scraper fetches the dashboard page
    Then a course list is produced containing one entry per enrolled course
    And each entry contains a non-empty course_name, a positive integer course_id, and a valid absolute HTTPS course_url

  Scenario: Dashboard returns HTTP error
    Given the user is authenticated
    When the scraper fetches the dashboard page
    And the server responds with HTTP 500
    Then the scraping session aborts immediately
    And the error message "Failed to load dashboard: HTTP 500" is printed to stderr
    And the process exits with code 2

  Scenario: Dashboard is reachable but zero courses are present
    Given the user is authenticated
    When the scraper fetches the dashboard page
    And the page contains no parseable course entries
    Then a warning "No enrolled courses found on dashboard. Verify login and enrollment." is printed to stderr
    And the process exits with code 0

  Scenario: One course entry is malformed (missing course ID)
    Given the dashboard page contains three course entries
    And one entry has no parseable Moodle course ID
    When the scraper parses the dashboard
    Then the malformed entry is skipped
    And a warning "Skipping malformed course entry: <course_name>" is printed to stderr
    And the remaining two courses are included in the course list
  ```
- **Rules**:
  - RULE-SCRAPE-001-A: The dashboard URL is always constructed as `<configured_base_url>/my/` — it is never hardcoded to a full path beyond the base.
  - RULE-SCRAPE-001-B: `course_id` must be a positive integer greater than 0; string or float values are rejected and the entry is skipped.
  - RULE-SCRAPE-001-C: `course_url` must be an absolute HTTPS URL beginning with the configured base URL; relative URLs are resolved against the base URL before storing.
  - RULE-SCRAPE-001-D: The course list is built before any course-level content fetching begins; no course page is fetched during this step.
- **Dependencies**: REQ-AUTH-001 (valid authenticated session required)

---

### REQ-SCRAPE-002: Course Content Tree Traversal
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: For each course in the course list produced by REQ-SCRAPE-001, the scraper fetches that course's main page and parses the full content tree. The tree consists of top-level sections and items within each section. For each section the scraper extracts: section name (string; empty-named sections use the string `"Section <order>"` where `<order>` is the 1-based position), and section order number (positive integer, 1-based). For each item within a section the scraper extracts: item type (one of: `resource`, `folder`, `url`, `assign`, `forum`, `news`, `label`; unknown types are captured as `unknown`), item name (string, non-empty), item Moodle ID (positive integer extracted from the URL parameter `id`), and item URL (absolute HTTPS URL).
- **Trigger**: Triggered once per course immediately after REQ-SCRAPE-001 produces the course list, before any file downloads begin.
- **Input**: One course object from the course list (`course_url`, `course_id`, `course_name`) and the authenticated HTTP session.
- **Output / Outcome**: An in-memory content tree for the course: an ordered list of sections, each containing an ordered list of item objects. The tree is passed to the type-specific download handlers (REQ-SCRAPE-003 through REQ-SCRAPE-008).
- **Error Conditions**:
  - HTTP status != 200 fetching the course page: skip this course entirely, emit warning `"Skipping course '<course_name>' (id=<course_id>): HTTP <status>"`, continue with next course.
  - Course page is reachable but contains zero parseable sections: emit warning `"Course '<course_name>' has no parseable sections — skipping."`, continue with next course.
  - A section contains zero items: the section is still recorded (for filesystem structure purposes) but no download steps are enqueued for it.
  - An item entry is missing `id` URL parameter or item name: skip that item, emit warning `"Skipping malformed item in course '<course_name>' section '<section_name>': <raw_html_snippet_max_80_chars>"`, continue parsing.
  - An item has a type not in the recognised set: record it as type `unknown`, emit info log `"Unknown item type '<type_string>' in course '<course_name>' — recorded but not downloaded."`.
  - Network timeout or connection error: handled per REQ-ERR-* retry policy.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Course page with multiple sections and mixed item types
    Given the course list contains a course with course_url "https://moodle.hwr-berlin.de/course/view.php?id=42"
    And the authenticated session is valid
    When the scraper fetches the course page
    Then the content tree contains one entry per section in page order
    And each section entry contains its section name and 1-based order number
    And each item entry contains item_type, item_name, item_id (positive integer), and item_url

  Scenario: Course page returns HTTP 403
    Given the course list contains a course "Advanced Topics" with id=99
    When the scraper fetches that course page
    And the server responds with HTTP 403
    Then that course is skipped entirely
    And the warning "Skipping course 'Advanced Topics' (id=99): HTTP 403" is printed to stderr
    And scraping continues with the next course

  Scenario: Section has an unnamed label
    Given a course section contains an item with no extractable name
    When the scraper parses that section
    Then that item is skipped
    And a warning containing "Skipping malformed item" is printed to stderr

  Scenario: Item type is unrecognised
    Given a course section contains an item of type "scorm"
    When the scraper parses that section
    Then an item entry with type "unknown" is recorded for it
    And an info log "Unknown item type 'scorm' in course '<course_name>' — recorded but not downloaded." is emitted
  ```
- **Rules**:
  - RULE-SCRAPE-002-A: Section order numbers start at 1 and increment by 1 in the order sections appear in the page DOM, regardless of Moodle's internal section numbering.
  - RULE-SCRAPE-002-B: An unnamed section (empty or whitespace-only name in the HTML) is assigned the name `"Section <order>"` where `<order>` is its 1-based position.
  - RULE-SCRAPE-002-C: `item_id` is parsed from the `id` query parameter of the item URL and must be a positive integer; items without a valid `id` are skipped.
  - RULE-SCRAPE-002-D: `item_url` is resolved to an absolute HTTPS URL using the base URL before storing; relative URLs are not stored as-is.
  - RULE-SCRAPE-002-E: Items of type `unknown` are logged but never downloaded or written to disk (no placeholder file is created).
  - RULE-SCRAPE-002-F: The full content tree for all courses is built before any file downloads begin, so the total item count is known and REQ-SCRAPE-011's "file X of Y" counter can be initialised.
- **Dependencies**: REQ-SCRAPE-001 (course list), REQ-AUTH-001 (authenticated session)

---

### REQ-SCRAPE-003: Resource File Download
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: For each item of type `resource` identified during course tree traversal (REQ-SCRAPE-002), the scraper follows the Moodle resource URL. This URL may issue one or more HTTP redirects before reaching the actual file. The scraper follows all redirects (up to a maximum of 10), then downloads the resulting response body and saves it to the correct output path determined by REQ-FS-*. The file is streamed directly to disk (per REQ-SCRAPE-009). The original filename is taken from the final redirect URL's path component, falling back to the `Content-Disposition` response header's `filename` parameter if the URL path component has no file extension. The Moodle item name is used as a final fallback if neither source yields a usable filename.
- **Trigger**: An item of type `resource` exists in the content tree for the current course section.
- **Input**: The resource item object (`item_url`, `item_name`, `item_id`) and the authenticated HTTP session.
- **Output / Outcome**: The file is saved to the output path `<output_dir>/<sanitised_course_name>/<section_order>-<sanitised_section_name>/<filename>`. File contents exactly match the bytes served by the server. If the file already exists and the sync logic (REQ-SYNC-*) determines it is unchanged, it is not re-downloaded (no file modification on disk).
- **Error Conditions**:
  - HTTP status 403 or Moodle "you do not have access" page returned at any step in the redirect chain: skip this resource per REQ-SCRAPE-012.
  - HTTP status 404: skip this resource, emit warning `"Resource not found (404): '<item_name>' at <final_url>"`, continue.
  - HTTP status 5xx: treated as transient; retry per REQ-ERR-* policy (up to 3 times); if all retries fail, skip and emit warning `"Download failed after retries: '<item_name>' — HTTP <status>"`.
  - Redirect count exceeds 10: skip this resource, emit warning `"Too many redirects for resource '<item_name>': <item_url>"`, continue.
  - Disk write error (e.g. disk full, permission denied): emit fatal error `"Disk write error saving '<item_name>': <os_error_message>"`, abort the entire scraping session, exit with code 3.
  - Downloaded file size does not match `Content-Length` header (when header is present): delete the partial file, emit warning `"Incomplete download for '<item_name>': expected <expected> bytes, got <actual> bytes. Skipping."`, continue.
  - Network connection drops mid-download: retry from the beginning (no range requests assumed); applies the same retry policy as 5xx.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Successful resource download with redirect
    Given a resource item with item_url "https://moodle.hwr-berlin.de/mod/resource/view.php?id=123"
    And the URL redirects once to "https://moodle.hwr-berlin.de/pluginfile.php/456/mod_resource/content/1/lecture.pdf"
    And the authenticated session is valid
    When the scraper processes this resource item
    Then the file "lecture.pdf" is saved to the correct output path
    And the file contents exactly match the bytes at the final redirect URL

  Scenario: Resource returns HTTP 403
    Given a resource item "Restricted Slides" at item_url "https://moodle.hwr-berlin.de/mod/resource/view.php?id=789"
    When the scraper follows the resource URL
    And the server responds with HTTP 403
    Then the resource is skipped
    And a warning is emitted per REQ-SCRAPE-012
    And scraping continues with the next item

  Scenario: Resource URL exceeds redirect limit
    Given a resource item whose URL chain produces 11 consecutive redirects
    When the scraper follows the redirect chain
    Then downloading stops after the 10th redirect
    And the warning "Too many redirects for resource '<item_name>': <item_url>" is printed to stderr
    And the item is skipped without writing any file

  Scenario: Disk is full during download
    Given a resource download is in progress
    When the OS reports a disk-full error during the file write
    Then the scraping session aborts immediately
    And the error "Disk write error saving '<item_name>': <os_error_message>" is printed to stderr
    And the process exits with code 3
  ```
- **Rules**:
  - RULE-SCRAPE-003-A: The maximum number of redirects followed per resource URL is 10; the 11th redirect causes the item to be skipped with a warning.
  - RULE-SCRAPE-003-B: Filename resolution order is: (1) path component of the final URL if it contains a file extension; (2) `filename` parameter from `Content-Disposition` header; (3) sanitised `item_name`. The chosen filename is sanitised per REQ-FS-* rules before writing.
  - RULE-SCRAPE-003-C: A partial file resulting from an incomplete download or mid-stream error must be deleted before the warning is emitted; no zero-byte or partial files are left on disk.
  - RULE-SCRAPE-003-D: File downloads are streamed (per REQ-SCRAPE-009); the full response body is never buffered in memory.
  - RULE-SCRAPE-003-E: If the sync layer (REQ-SYNC-*) determines the remote file is unchanged (via ETag or Last-Modified), the download is skipped and no disk write occurs.
- **Dependencies**: REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-SCRAPE-009 (streaming), REQ-SYNC-* (change detection), REQ-FS-* (output paths), REQ-ERR-* (retry policy), REQ-SCRAPE-012 (403 handling)

---

### REQ-SCRAPE-004: Folder Traversal and Download
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: For each item of type `folder` identified during course tree traversal (REQ-SCRAPE-002), the scraper fetches the folder's Moodle page and parses all files and subfolders listed within it. Subfolders are traversed recursively without depth limit until no further nested folders are found. For every file discovered, the scraper downloads it and saves it to the output path that mirrors the folder's subfolder structure under the section folder. The subfolder hierarchy found on the Moodle folder page is reproduced exactly on disk.
- **Trigger**: An item of type `folder` exists in the content tree for the current course section.
- **Input**: The folder item object (`item_url`, `item_name`, `item_id`) and the authenticated HTTP session.
- **Output / Outcome**: All files within the folder (including all subfolders at any depth) are downloaded and saved under `<output_dir>/<sanitised_course_name>/<section_order>-<sanitised_section_name>/<sanitised_folder_name>/[<subfolder_path>/]<filename>`. The directory structure mirrors the folder structure on Moodle exactly. Empty subfolders (containing no files) are not created on disk.
- **Error Conditions**:
  - HTTP status != 200 fetching the folder page: skip this folder entirely, emit warning `"Skipping folder '<item_name>' (id=<item_id>): HTTP <status>"`, continue with next item.
  - HTTP 403 or access-denied page on folder page: skip per REQ-SCRAPE-012.
  - Folder page contains zero parseable files or subfolders: emit info log `"Folder '<item_name>' appears empty — nothing downloaded."`, continue.
  - A file within the folder fails to download: follow the same per-file error handling as REQ-SCRAPE-003 (skip on 403/404, retry on 5xx, fatal on disk error); remaining files in the folder continue to be processed.
  - Circular subfolder reference detected (a subfolder URL already visited in the current traversal chain): skip the repeated URL, emit warning `"Circular folder reference detected at <url> — skipping."`, continue.
  - Network timeout or connection error: handled per REQ-ERR-* retry policy.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Folder with nested subfolders
    Given a folder item "Lecture Slides" contains two subfolders "Week 1" and "Week 2"
    And "Week 1" contains "intro.pdf" and "Week 2" contains "advanced.pdf"
    And the authenticated session is valid
    When the scraper processes the folder item
    Then "intro.pdf" is saved at "<section_folder>/Lecture Slides/Week 1/intro.pdf"
    And "advanced.pdf" is saved at "<section_folder>/Lecture Slides/Week 2/advanced.pdf"

  Scenario: Folder page returns HTTP 403
    Given a folder item "Restricted Materials" with item_id=55
    When the scraper fetches the folder page
    And the server responds with HTTP 403
    Then the folder is skipped per REQ-SCRAPE-012
    And scraping continues with the next item

  Scenario: Folder is empty
    Given a folder item "Empty Folder" whose page contains no files or subfolders
    When the scraper fetches and parses the folder page
    Then no directory is created on disk for that folder
    And the info log "Folder 'Empty Folder' appears empty — nothing downloaded." is emitted

  Scenario: Circular folder reference
    Given a folder page at URL A contains a link to subfolder at URL B
    And subfolder at URL B contains a link back to URL A
    When the scraper traverses the folder from URL A
    Then URL A is visited once
    And when URL B's link back to URL A is encountered, it is skipped
    And the warning "Circular folder reference detected at <url_A> — skipping." is emitted
  ```
- **Rules**:
  - RULE-SCRAPE-004-A: Subfolder traversal is recursive with no maximum depth limit; the cycle-detection rule (RULE-SCRAPE-004-B) prevents infinite loops.
  - RULE-SCRAPE-004-B: A set of already-visited folder URLs is maintained per folder-item traversal. Any URL already in the set is skipped with a warning.
  - RULE-SCRAPE-004-C: Empty subfolders (containing no downloadable files at any depth below them) are not created on disk.
  - RULE-SCRAPE-004-D: Individual file downloads within a folder follow all rules of REQ-SCRAPE-003 including streaming (REQ-SCRAPE-009) and sync skip logic (REQ-SYNC-*).
  - RULE-SCRAPE-004-E: The subfolder path components used on disk are sanitised per REQ-FS-* rules before directory creation.
- **Dependencies**: REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-SCRAPE-003 (per-file download rules), REQ-SCRAPE-009, REQ-FS-*, REQ-ERR-*, REQ-SCRAPE-012

---

### REQ-SCRAPE-005: External URL Recording
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: For each item of type `url` identified during course tree traversal (REQ-SCRAPE-002), the scraper does not fetch or download the external site. Instead it records the item's label (item name) and the external target URL in a Markdown file named `_external-links.md` located in the section folder. If `_external-links.md` already exists in that section folder (from a previous item or a previous run), the new entry is appended to the end of the file. The external target URL is the URL the Moodle `url` item resolves to (i.e. the URL configured in Moodle, not the Moodle view URL).
- **Trigger**: An item of type `url` exists in the content tree for the current course section.
- **Input**: The url item object (`item_url`, `item_name`, `item_id`) and the authenticated HTTP session (used only to resolve the external target URL from the Moodle url module page).
- **Output / Outcome**: The file `<output_dir>/<sanitised_course_name>/<section_order>-<sanitised_section_name>/_external-links.md` exists and contains one entry per `url` item in that section. Each entry is formatted as: `- [<item_name>](<external_target_url>)` on its own line, followed by a blank line. If the file did not exist it is created with a header line `# External Links` before the first entry.
- **Error Conditions**:
  - Fetching the Moodle url module page to resolve the external target URL returns HTTP != 200 or the external URL cannot be parsed from the page: record the Moodle view URL (`item_url`) as the target URL instead, and emit warning `"Could not resolve external URL for '<item_name>' (id=<item_id>) — storing Moodle URL as fallback."`.
  - HTTP 403 on the Moodle url module page: skip this item, emit warning per REQ-SCRAPE-012, do not write any entry to `_external-links.md` for this item.
  - Disk write error appending to `_external-links.md`: emit fatal error `"Disk write error updating '_external-links.md': <os_error_message>"`, abort session, exit with code 3.
  - `item_name` is empty: use the string `"Unnamed Link <item_id>"` as the label in the Markdown entry.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: First URL item in a section
    Given a course section "Resources" has one item of type "url" with item_name "Python Docs" and external target "https://docs.python.org"
    And no "_external-links.md" file exists in the section folder yet
    When the scraper processes this url item
    Then the file "_external-links.md" is created in the section folder
    And its contents are:
      """
      # External Links

      - [Python Docs](https://docs.python.org)

      """

  Scenario: Second URL item appended to existing file
    Given "_external-links.md" already exists in the section folder with one entry
    And a second url item "MDN Web Docs" with target "https://developer.mozilla.org" is processed
    When the scraper processes the second url item
    Then "- [MDN Web Docs](https://developer.mozilla.org)" is appended to "_external-links.md"
    And the file now contains two entries

  Scenario: External URL cannot be resolved from Moodle page
    Given a url item "Broken Link" whose Moodle url module page returns HTTP 500
    When the scraper attempts to resolve the external target URL
    Then the Moodle view URL (item_url) is used as the target URL
    And a warning "Could not resolve external URL for 'Broken Link' (id=<item_id>) — storing Moodle URL as fallback." is emitted
    And the entry is still written to "_external-links.md"

  Scenario: URL item returns HTTP 403
    Given a url item "Restricted Link" whose Moodle page returns HTTP 403
    When the scraper attempts to process this item
    Then no entry is written to "_external-links.md" for this item
    And a warning is emitted per REQ-SCRAPE-012
  ```
- **Rules**:
  - RULE-SCRAPE-005-A: The external site at the target URL is never fetched under any circumstances; only the Moodle url module page (on the Moodle server) is fetched to extract the configured external URL.
  - RULE-SCRAPE-005-B: `_external-links.md` is opened in append mode; existing content is never overwritten or truncated during a scraping run.
  - RULE-SCRAPE-005-C: If the file does not exist, it is created with the header `# External Links\n\n` before the first entry is appended.
  - RULE-SCRAPE-005-D: Each entry is written as `- [<label>](<url>)\n\n` (Markdown list item followed by one blank line).
  - RULE-SCRAPE-005-E: An empty `item_name` is replaced with `"Unnamed Link <item_id>"` for the label only; the `item_id` used is the Moodle integer item ID.
- **Dependencies**: REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-FS-* (section folder path), REQ-SCRAPE-012

---

### REQ-SCRAPE-006: Assignment Description Capture
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: For each item of type `assign` identified during course tree traversal (REQ-SCRAPE-002), the scraper fetches the assignment's Moodle page and extracts the assignment description HTML element. The HTML is converted to Markdown (preserving headings, bold, italic, lists, links, and code blocks; stripping Moodle-specific UI chrome). The resulting Markdown content is saved as a `.md` file in the section folder. The filename is derived by sanitising the assignment's item name per REQ-FS-* rules and appending `.md`. No submission attempt is made; this step is read-only.
- **Trigger**: An item of type `assign` exists in the content tree for the current course section.
- **Input**: The assign item object (`item_url`, `item_name`, `item_id`) and the authenticated HTTP session.
- **Output / Outcome**: A file `<output_dir>/<sanitised_course_name>/<section_order>-<sanitised_section_name>/<sanitised_item_name>.md` is created or overwritten. The file begins with a YAML front-matter block followed by the assignment description in Markdown. The YAML front-matter contains: `title` (the original `item_name` string), `moodle_id` (the integer `item_id`), `moodle_url` (the `item_url` string), `scraped_at` (ISO-8601 UTC timestamp of when this item was scraped).
- **Error Conditions**:
  - HTTP status != 200 fetching the assignment page: skip this item, emit warning `"Skipping assignment '<item_name>' (id=<item_id>): HTTP <status>"`, continue.
  - HTTP 403 or access-denied: skip per REQ-SCRAPE-012.
  - Assignment page is reachable but no description HTML element is found: write the file with front-matter only and a body line `_No description found._`, emit info log `"Assignment '<item_name>' has no description content."`.
  - HTML-to-Markdown conversion fails (exception in converter): save the raw description HTML inside a fenced code block with language tag `html` in the Markdown file instead; emit warning `"HTML→Markdown conversion failed for assignment '<item_name>' — raw HTML saved."`.
  - Disk write error: emit fatal error `"Disk write error saving assignment '<item_name>': <os_error_message>"`, abort session, exit code 3.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Assignment with a rich description
    Given an assign item "Essay Submission" with item_id=200 and a description containing headings and bullet lists
    And the authenticated session is valid
    When the scraper processes this assign item
    Then the file "Essay Submission.md" is created in the section folder
    And the file begins with YAML front-matter containing title, moodle_id, moodle_url, and scraped_at fields
    And the file body contains the description converted to Markdown with headings and lists preserved

  Scenario: Assignment page returns HTTP 403
    Given an assign item "Locked Assignment" whose page returns HTTP 403
    When the scraper fetches the assignment page
    Then the item is skipped per REQ-SCRAPE-012
    And no file is created for this assignment

  Scenario: Assignment page has no description element
    Given an assign item "Empty Task" whose page contains no description element
    When the scraper fetches and parses the page
    Then the file "Empty Task.md" is created with front-matter only
    And the body contains the line "_No description found._"
    And the info log "Assignment 'Empty Task' has no description content." is emitted

  Scenario: HTML-to-Markdown conversion raises an exception
    Given an assign item "Broken HTML Task" whose description HTML causes the converter to throw
    When the scraper attempts conversion
    Then the raw HTML is saved inside a fenced code block in the output file
    And the warning "HTML→Markdown conversion failed for assignment 'Broken HTML Task' — raw HTML saved." is emitted
  ```
- **Rules**:
  - RULE-SCRAPE-006-A: The scraper never submits, modifies, or interacts with the assignment submission form; all HTTP interactions with the assignment page are GET requests only.
  - RULE-SCRAPE-006-B: The YAML front-matter fields are always present in this order: `title`, `moodle_id`, `moodle_url`, `scraped_at`. No other fields are added unless specified in a future requirement.
  - RULE-SCRAPE-006-C: `scraped_at` is formatted as ISO-8601 UTC: `YYYY-MM-DDTHH:MM:SSZ`.
  - RULE-SCRAPE-006-D: The Markdown converter must preserve: headings (h1–h6), bold, italic, unordered lists, ordered lists, hyperlinks, and fenced code blocks. Moodle navigation bars, breadcrumbs, and footer HTML are stripped before conversion.
  - RULE-SCRAPE-006-E: The output filename is `<sanitised_item_name>.md`; filename sanitisation follows REQ-FS-* rules; if sanitisation produces an empty string the filename `"assignment-<item_id>.md"` is used instead.
- **Dependencies**: REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-FS-*, REQ-SCRAPE-012

---

### REQ-SCRAPE-007: Forum and Announcement Archiving
- **Type**: Functional
- **Priority**: Should-Have
- **Description**: For each item of type `forum` or `news` identified during course tree traversal (REQ-SCRAPE-002), the scraper fetches the forum's post list page and collects all post entries. For each post it then fetches the individual post's full-content page. The post content is converted from HTML to Markdown using the same converter as REQ-SCRAPE-006. Each post is saved as a separate Markdown file. Files are organised under a subfolder named after the sanitised forum item name, inside the section folder. The Markdown file includes YAML front-matter with post metadata.
- **Trigger**: An item of type `forum` or `news` exists in the content tree for the current course section.
- **Input**: The forum item object (`item_url`, `item_name`, `item_id`) and the authenticated HTTP session.
- **Output / Outcome**: A subfolder `<output_dir>/<sanitised_course_name>/<section_order>-<sanitised_section_name>/<sanitised_forum_name>/` is created. Inside it, one `.md` file per forum post is saved as `<sanitised_post_title>.md`. Each file contains YAML front-matter with: `title` (original post title string), `author` (post author's display name string), `posted_at` (ISO-8601 UTC timestamp of the post's publication date), `moodle_forum_id` (integer `item_id` of the forum), `moodle_post_url` (absolute URL of the individual post page). The file body is the post content in Markdown.
- **Error Conditions**:
  - HTTP status != 200 fetching the forum post list page: skip this forum entirely, emit warning `"Skipping forum '<item_name>' (id=<item_id>): HTTP <status>"`, continue.
  - HTTP 403 or access-denied on forum list: skip per REQ-SCRAPE-012.
  - Forum post list page contains zero posts: emit info log `"Forum '<item_name>' has no posts — nothing to archive."`, do not create the subfolder.
  - HTTP status != 200 fetching an individual post page: skip that post, emit warning `"Skipping post '<post_title>' in forum '<item_name>': HTTP <status>"`, continue with remaining posts.
  - Post author or date cannot be parsed from the post page: use `"Unknown"` for the author field and `"Unknown"` for the `posted_at` field; emit warning `"Could not parse metadata for post '<post_title>' in forum '<item_name>'."`.
  - HTML-to-Markdown conversion fails for a post: save raw HTML in a fenced code block (same as RULE-SCRAPE-006-D fallback); emit warning.
  - Two posts in the same forum have titles that sanitise to the same filename: append `_<moodle_post_id>` to the later file's name to avoid collision.
  - Disk write error: emit fatal error, abort session, exit code 3.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Forum with multiple posts
    Given a forum item "Course Announcements" with two posts: "Welcome!" and "Assignment Update"
    And each post has an author name and publication date
    When the scraper processes this forum item
    Then the subfolder "Course Announcements/" is created inside the section folder
    And "Welcome!.md" and "Assignment Update.md" are saved inside it
    And each file contains YAML front-matter with title, author, posted_at, moodle_forum_id, and moodle_post_url

  Scenario: Forum post list page returns HTTP 403
    Given a forum item "Restricted Forum" whose post list page returns HTTP 403
    When the scraper fetches the post list
    Then the forum is skipped per REQ-SCRAPE-012
    And no subfolder is created

  Scenario: Forum has no posts
    Given a forum item "Empty Forum" whose post list page returns zero posts
    When the scraper parses the post list
    Then no subfolder is created for this forum
    And the info log "Forum 'Empty Forum' has no posts — nothing to archive." is emitted

  Scenario: Two posts with titles that collide after sanitisation
    Given a forum with two posts both titled "Update!" (same sanitised filename)
    When the scraper processes the second post
    Then the second post's file is saved as "Update!_<moodle_post_id>.md"
    And the first post's file is not renamed
  ```
- **Rules**:
  - RULE-SCRAPE-007-A: The forum subfolder is only created on disk once at least one post file is about to be written; an empty forum produces no directory.
  - RULE-SCRAPE-007-B: YAML front-matter fields are always in this order: `title`, `author`, `posted_at`, `moodle_forum_id`, `moodle_post_url`.
  - RULE-SCRAPE-007-C: `posted_at` is stored as ISO-8601 UTC; if the post page provides a local time without timezone, it is stored as-is with a `_tz_unknown` suffix rather than silently converting (e.g. `"2024-10-01T14:00:00_tz_unknown"`).
  - RULE-SCRAPE-007-D: Filename collision resolution appends `_<moodle_post_id>` to the newer file's name (not the older one's). The `moodle_post_id` is the integer ID extracted from the post page URL.
  - RULE-SCRAPE-007-E: Post content HTML-to-Markdown conversion follows the same rules as RULE-SCRAPE-006-D.
  - RULE-SCRAPE-007-F: The scraper never posts, replies to, or modifies any forum content; all interactions are GET requests only.
- **Dependencies**: REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-FS-*, REQ-SCRAPE-012

---

### REQ-SCRAPE-008: Inline Label/Text Capture
- **Type**: Functional
- **Priority**: Should-Have
- **Description**: For each course section that contains one or more items of type `label` (inline text or HTML labels embedded directly in the section, not links to separate pages), the scraper collects all label texts from that section in their page order and saves them combined into a single file called `_section-notes.md` in that section's folder. All labels from a section are combined into one file; labels from different sections go into their respective section folders. Each label's HTML content is converted to Markdown using the same converter as REQ-SCRAPE-006. Labels are separated by a Markdown horizontal rule (`---`) in the combined file.
- **Trigger**: At least one item of type `label` exists in the content tree for a course section.
- **Input**: All label items within a single section (each with its `item_name`, `item_id`, and inline HTML content extracted during tree traversal in REQ-SCRAPE-002 — label content is inline and does not require a separate HTTP request).
- **Output / Outcome**: A file `<output_dir>/<sanitised_course_name>/<section_order>-<sanitised_section_name>/_section-notes.md` is created or overwritten. The file begins with the header `# Section Notes` followed by a blank line. Each label's Markdown-converted content follows, separated by `\n\n---\n\n` between labels. Labels appear in the order they appear in the section on the Moodle page.
- **Error Conditions**:
  - HTML-to-Markdown conversion fails for a label: save the raw HTML in a fenced code block (same fallback as RULE-SCRAPE-006-D); emit warning `"HTML→Markdown conversion failed for a label in section '<section_name>' of course '<course_name>' — raw HTML saved."`.
  - All labels in a section have empty content after conversion (whitespace-only): do not create `_section-notes.md` for that section; emit info log `"All labels in section '<section_name>' are empty — skipping _section-notes.md."`.
  - Disk write error creating `_section-notes.md`: emit fatal error `"Disk write error saving '_section-notes.md' for section '<section_name>': <os_error_message>"`, abort session, exit code 3.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Section with two inline labels
    Given a section "Week 1" contains two label items: "Welcome message HTML" and "Reading list HTML"
    When the scraper processes section "Week 1"
    Then "_section-notes.md" is created in the "Week 1" section folder
    And the file begins with "# Section Notes"
    And the two labels are present in page order separated by "\n\n---\n\n"

  Scenario: Section has no label items
    Given a section "Week 2" contains only resource and url items (no labels)
    When the scraper processes section "Week 2"
    Then no "_section-notes.md" file is created for that section

  Scenario: All labels in a section are empty after conversion
    Given a section "Week 3" contains two label items that both convert to empty strings
    When the scraper processes the labels
    Then no "_section-notes.md" is created
    And the info log "All labels in section 'Week 3' are empty — skipping _section-notes.md." is emitted

  Scenario: HTML-to-Markdown conversion fails for one label
    Given a section "Week 4" has two labels, the second of which causes the converter to throw
    When the scraper processes the second label
    Then the raw HTML of the second label is saved in a fenced code block in "_section-notes.md"
    And the warning about conversion failure for that section is emitted
  ```
- **Rules**:
  - RULE-SCRAPE-008-A: Label content is extracted entirely from the course page DOM during tree traversal (REQ-SCRAPE-002); no additional HTTP request is made per label item.
  - RULE-SCRAPE-008-B: Labels within a section are combined in the order they appear in the DOM, not sorted alphabetically or by ID.
  - RULE-SCRAPE-008-C: The separator between labels in `_section-notes.md` is exactly `\n\n---\n\n` (blank line, three dashes, blank line).
  - RULE-SCRAPE-008-D: `_section-notes.md` is written once per section in a single write operation after all labels are collected; it is not incrementally appended label-by-label.
  - RULE-SCRAPE-008-E: If a section has no labels, `_section-notes.md` is not created and no empty file is left on disk for that section.
- **Dependencies**: REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-FS-*

---

### REQ-SCRAPE-009: Streaming File Downloads
- **Type**: Non-Functional
- **Priority**: Must-Have
- **Description**: Every file download performed by the scraper (resources via REQ-SCRAPE-003, folder files via REQ-SCRAPE-004) must be streamed directly from the HTTP response body to the destination file on disk. At no point during a download may the entire file content be held in heap memory simultaneously. The maximum in-memory buffer per in-flight download is 8 MiB. This requirement applies regardless of file size and regardless of the number of concurrent downloads.
- **Trigger**: Any file download is initiated (types `resource` or files within `folder` items).
- **Input**: An open HTTP response object with a streaming body; the target file path on disk.
- **Output / Outcome**: The file is written to disk in chunks. Each chunk is at most 8 MiB in size. The response body stream and the file write stream are connected so that each chunk is written to disk before the next chunk is read from the network. Memory consumption per download never exceeds the 8 MiB chunk size plus minimal overhead.
- **Error Conditions**:
  - The HTTP response does not support streaming (e.g. the HTTP client returns a pre-buffered response object): this is a programming error and must be caught at the integration test level (REQ is a constraint on implementation choice); if detected at runtime emit fatal error `"Streaming not available for download of '<filename>' — aborting."`, exit code 2.
  - The write stream to disk raises an error mid-stream: the partial file is deleted; error handling follows REQ-SCRAPE-003's disk error rule (fatal abort, exit code 3).
  - The read stream from the HTTP response drops mid-download: the partial file is deleted; follows the retry policy in REQ-ERR-* for network errors.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Large file download stays within memory bound
    Given a resource file of size 500 MiB is being downloaded
    When the scraper streams it to disk
    Then at no point does heap memory allocated to the download buffer exceed 8 MiB for that file
    And the complete file is correctly written to disk

  Scenario: Concurrent downloads respect individual streaming constraint
    Given the concurrent download limit is set to 3
    And three 200 MiB files are downloading simultaneously
    When all three downloads are in progress
    Then the combined in-memory buffer for the three downloads does not exceed 3 * 8 MiB = 24 MiB
    And all three files are correctly written to disk upon completion

  Scenario: Write stream error mid-download
    Given a file download is 60% complete
    When the OS raises a write error (e.g. disk full)
    Then the partial file is deleted from disk
    And the error handling follows REQ-SCRAPE-003 (fatal abort, exit code 3)
  ```
- **Rules**:
  - RULE-SCRAPE-009-A: The maximum per-download in-memory chunk size is 8 MiB (8,388,608 bytes). This value is a compile-time or configuration constant; it is not user-configurable.
  - RULE-SCRAPE-009-B: The HTTP client must be configured to not pre-buffer the response body; the implementation must use the client's streaming / chunked-reading API.
  - RULE-SCRAPE-009-C: No temporary file buffering is used (i.e. writing to a temp file then copying); the download writes directly to the final destination path via a streaming write.
  - RULE-SCRAPE-009-D: If a partial file remains on disk after a failed download it must be deleted before the warning or error is emitted.
- **Dependencies**: REQ-SCRAPE-003, REQ-SCRAPE-004, REQ-ERR-*

---

### REQ-SCRAPE-010: Concurrent Download Limit
- **Type**: Non-Functional
- **Priority**: Must-Have
- **Description**: The number of simultaneously in-flight download requests (HTTP connections actively streaming file data) is controlled by a concurrency setting. The default value is 3. The allowed range is 1 to 10 inclusive. If the user supplies a value outside this range via the CLI or configuration file, the scraper rejects it at startup before any network activity occurs, prints a clear error message specifying the valid range, and exits with a non-zero exit code. Content tree traversal (fetching course and section pages) is not subject to this limit; the limit applies only to file download requests.
- **Trigger**: The scraping session is about to begin downloading files; also triggered at startup when the concurrency value is read from CLI arguments or configuration.
- **Input**: The concurrency value as a positive integer, sourced from (in precedence order): (1) `--concurrency <n>` CLI flag, (2) `concurrency` key in the configuration file, (3) default value of 3.
- **Output / Outcome**: During the file download phase, at most `<concurrency>` download requests are active at any instant. When one download completes, the next queued download starts immediately (no idle gap). The concurrency limit is enforced via a semaphore or equivalent mechanism.
- **Error Conditions**:
  - Concurrency value is 0 or negative: print `"Error: --concurrency must be between 1 and 10 (got <value>)."` to stderr, exit with code 1.
  - Concurrency value exceeds 10: print `"Error: --concurrency must be between 1 and 10 (got <value>)."` to stderr, exit with code 1.
  - Concurrency value is not an integer (e.g. `"fast"`, `3.5`): print `"Error: --concurrency must be an integer between 1 and 10 (got '<value>')."` to stderr, exit with code 1.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Default concurrency is used when not specified
    Given no --concurrency flag is passed and no configuration file entry exists
    When the scraper starts a download session
    Then at most 3 download requests are active simultaneously at any point

  Scenario: Valid custom concurrency is accepted
    Given the user passes --concurrency 5
    When the scraper starts a download session with 20 files queued
    Then at most 5 download requests are active simultaneously at any point

  Scenario: Concurrency value of 0 is rejected at startup
    Given the user passes --concurrency 0
    When the scraper initialises
    Then no network request is made
    And the message "Error: --concurrency must be between 1 and 10 (got 0)." is printed to stderr
    And the process exits with code 1

  Scenario: Concurrency value of 11 is rejected at startup
    Given the user passes --concurrency 11
    When the scraper initialises
    Then no network request is made
    And the message "Error: --concurrency must be between 1 and 10 (got 11)." is printed to stderr
    And the process exits with code 1

  Scenario: Concurrency value is a non-integer string
    Given the user passes --concurrency fast
    When the scraper initialises
    Then no network request is made
    And the message "Error: --concurrency must be an integer between 1 and 10 (got 'fast')." is printed to stderr
    And the process exits with code 1
  ```
- **Rules**:
  - RULE-SCRAPE-010-A: The valid range for concurrency is the closed interval [1, 10]. Both 1 and 10 are valid values.
  - RULE-SCRAPE-010-B: Validation of the concurrency value occurs before any authentication or network activity; an invalid value causes immediate exit with code 1.
  - RULE-SCRAPE-010-C: The concurrency limit is implemented as a semaphore (or equivalent counting gate) that permits at most `<concurrency>` goroutines/threads/coroutines to be actively downloading at once.
  - RULE-SCRAPE-010-D: Content tree traversal requests (course pages, section pages, forum post list pages) are not subject to the concurrency limit and may proceed without queuing.
  - RULE-SCRAPE-010-E: The default concurrency value of 3 is a compile-time constant; it is not read from any external file unless overridden by the user.
- **Dependencies**: REQ-CLI-* (CLI flag parsing), REQ-SCRAPE-003, REQ-SCRAPE-004

---

### REQ-SCRAPE-011: Download Progress Display
- **Type**: UX
- **Priority**: Must-Have
- **Description**: During the file download phase, the scraper displays real-time progress information on stdout (or the terminal's stderr if stdout is redirected to a file). Progress is shown at two levels: (1) per-file progress showing the filename, the total file size in human-readable form if known from the `Content-Length` response header, and the current download percentage or progress bar; (2) an overall counter in the form `"Downloading file X of Y"` where X is the number of files whose download has started (including those currently in progress) and Y is the total number of files to download, known after tree traversal completes (per RULE-SCRAPE-002-F). When stdout is not a TTY (e.g. piped to a file), progress display is suppressed entirely and only completion/error log lines are emitted.
- **Trigger**: A file download starts or makes progress.
- **Input**: Per-file: filename string, `Content-Length` header value (integer bytes, may be absent), bytes downloaded so far (integer). Overall: total file count Y (known after tree traversal), current started-download count X.
- **Output / Outcome**: For each active download a line (or in-place updated line on TTY) shows: `[X/Y] <filename> <downloaded_bytes>/<total_bytes> (<percentage>%)` where `<total_bytes>` is shown as `?` and `<percentage>` is omitted when `Content-Length` is absent. Human-readable byte formatting is used (e.g. `12.3 MiB`, `450 KiB`). On TTY, lines update in-place using terminal cursor control (not appended as new lines). On non-TTY, the progress display is completely suppressed.
- **Error Conditions**:
  - `Content-Length` header is absent: display progress as `<downloaded_bytes>/?` with no percentage; do not display a progress bar.
  - `Content-Length` header is present but the actual downloaded bytes exceed it: display percentage capped at 100% for display purposes; the size discrepancy is handled by REQ-SCRAPE-003's size-mismatch error condition.
  - Terminal width cannot be determined: use a default terminal width of 80 characters for progress bar sizing.
  - Progress display itself raises an exception: suppress progress display silently for the remainder of the run; scraping continues normally.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: File download with known Content-Length on a TTY
    Given the scraper is downloading file 3 of 15 named "lecture.pdf" (size 5.0 MiB)
    And the terminal is a TTY
    When 2.5 MiB have been downloaded
    Then the progress line shows "[3/15] lecture.pdf 2.5 MiB/5.0 MiB (50%)"
    And the line updates in-place (no new line printed per progress update)

  Scenario: File download without Content-Length on a TTY
    Given the scraper is downloading file 7 of 15 named "notes.pdf" with no Content-Length header
    And the terminal is a TTY
    When 1.2 MiB have been downloaded
    Then the progress line shows "[7/15] notes.pdf 1.2 MiB/?"
    And no percentage is shown

  Scenario: Stdout is not a TTY (piped output)
    Given the scraper's stdout is piped to a file
    When file downloads are in progress
    Then no progress lines are written to stdout or stderr
    And only completion and error log lines are emitted

  Scenario: Multiple concurrent downloads on a TTY
    Given the concurrency limit is 3 and three files are downloading simultaneously
    When all three are in progress
    Then three separate in-place-updated progress lines are shown, one per active download
  ```
- **Rules**:
  - RULE-SCRAPE-011-A: The overall counter format is exactly `[X/Y]` where X and Y are decimal integers with no padding. X is the count of files whose download has been initiated (including currently in-progress downloads); Y is the total file count determined after tree traversal.
  - RULE-SCRAPE-011-B: Human-readable byte units use binary prefixes: B, KiB, MiB, GiB. Values are rounded to one decimal place (e.g. `1.0 KiB`, `12.3 MiB`). Values below 1 KiB are shown as integer bytes (e.g. `512 B`).
  - RULE-SCRAPE-011-C: TTY detection uses the standard OS isatty check on the output stream; if the check raises an exception the output is treated as non-TTY.
  - RULE-SCRAPE-011-D: On TTY, in-place line update uses ANSI cursor-up and carriage-return sequences. On non-TTY, these sequences are never emitted.
  - RULE-SCRAPE-011-E: If `Content-Length` is absent, no progress bar or percentage is shown; the downloaded bytes counter is still shown and updated.
  - RULE-SCRAPE-011-F: An exception raised by the progress display logic must be caught and suppressed; it must not propagate to the download logic or abort scraping.
- **Dependencies**: REQ-SCRAPE-002 (total file count), REQ-SCRAPE-003, REQ-SCRAPE-004, REQ-SCRAPE-010 (concurrency), REQ-CLI-*

---

### REQ-SCRAPE-012: Inaccessible / Restricted Content Handling
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: When the scraper encounters a resource (of any scrapeable type) that is inaccessible due to a HTTP 403 response or a Moodle "you do not have access to this page" HTML response body, it treats this as a non-fatal skip condition. The resource is skipped entirely (no file is written, no partial file is left), a human-readable warning is emitted to stderr, and scraping continues with the next item. This condition never causes the scraping session to abort. The detection of a Moodle access-denied page applies when the HTTP status is 200 but the page body contains the Moodle access-denied indicator string.
- **Trigger**: Any HTTP request made during scraping receives an HTTP 403 response, or receives HTTP 200 with a response body containing the Moodle access-denied indicator.
- **Input**: The HTTP response (status code and body) for any scraping request; the item object being scraped (`item_type`, `item_name`, `item_url`, `item_id`).
- **Output / Outcome**: The inaccessible item is skipped. A warning line is printed to stderr in the format: `"WARNING: Skipping <item_type> '<item_name>' (id=<item_id>) — access denied: <item_url>"`. No file is created for this item. The total skipped-due-to-access-denied count is tracked and reported in the run summary (per REQ-CLI-*). Scraping proceeds to the next item.
- **Error Conditions**:
  - The access-denied detection heuristic produces a false positive (HTTP 200 page that contains the indicator string but is not actually a denial): this is accepted as a known limitation; the item is still skipped and the warning is still emitted.
  - The same item is encountered again during the same run (e.g. via a folder that references it): the skip and warning are emitted again for the repeated encounter; no deduplication is applied within a run.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Resource returns HTTP 403
    Given a resource item "Restricted PDF" with item_id=300 and item_url="https://moodle.hwr-berlin.de/mod/resource/view.php?id=300"
    When the scraper fetches the resource URL
    And the server responds with HTTP 403
    Then no file is written for "Restricted PDF"
    And the warning "WARNING: Skipping resource 'Restricted PDF' (id=300) — access denied: https://moodle.hwr-berlin.de/mod/resource/view.php?id=300" is printed to stderr
    And scraping continues with the next item

  Scenario: Resource returns HTTP 200 with Moodle access-denied body
    Given an assign item "Hidden Assignment" with item_id=301
    When the scraper fetches the assignment page
    And the server responds with HTTP 200
    And the response body contains the Moodle access-denied indicator string
    Then no file is written for "Hidden Assignment"
    And the warning "WARNING: Skipping assign 'Hidden Assignment' (id=301) — access denied: <item_url>" is printed to stderr
    And scraping continues with the next item

  Scenario: Multiple restricted items do not abort the session
    Given a course section contains 5 items of which 3 return HTTP 403
    When the scraper processes all 5 items
    Then 3 warnings are emitted for the inaccessible items
    And the 2 accessible items are successfully downloaded
    And the scraping session completes normally (exit code 0)

  Scenario: Access-denied count is included in run summary
    Given a completed scraping run in which 4 items were skipped due to access denial
    When the run summary is printed
    Then the summary includes the line "Skipped (access denied): 4"
  ```
- **Rules**:
  - RULE-SCRAPE-012-A: The Moodle access-denied indicator string is `"You do not have access to this page"`. This string is matched case-insensitively against the response body. This is a constant defined in a single location in the codebase.
  - RULE-SCRAPE-012-B: A HTTP 403 response is always treated as access-denied regardless of the response body content.
  - RULE-SCRAPE-012-C: The warning format is exactly: `"WARNING: Skipping <item_type> '<item_name>' (id=<item_id>) — access denied: <item_url>"` — no deviation from this format.
  - RULE-SCRAPE-012-D: This requirement overrides any type-specific error handling in REQ-SCRAPE-003 through REQ-SCRAPE-008 for the 403/access-denied case; those requirements' 403 clauses defer to this requirement.
  - RULE-SCRAPE-012-E: The count of items skipped due to access denial is accumulated in a run-level counter and included in the run summary output.
  - RULE-SCRAPE-012-F: No retry is attempted on a 403 or access-denied response; the item is immediately skipped on first encounter.
- **Dependencies**: REQ-SCRAPE-001, REQ-SCRAPE-002, REQ-CLI-* (run summary output)

---

## Incremental Sync & Change Detection

---

### REQ-SYNC-001: State File Creation and Update
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: After every scrape run (full or incremental), the application must write or update a JSON state file that records the sync state of every resource encountered during that run. The file is an array of state entry objects. Each entry records exactly five fields: `resourceId` (the Moodle item ID as a string), `localPath` (the file path relative to the output directory, using forward slashes), `lastModified` (the value of the HTTP `Last-Modified` response header serialised as an ISO 8601 string, or `null` if the header was absent), `contentHash` (the lowercase hex-encoded SHA-256 digest of the file's byte content as stored on disk), `downloadedAt` (the ISO 8601 UTC timestamp at which the download completed), and `status` (the string literal `"ok"` for an active resource or `"orphan"` for a resource no longer present on Moodle). The file is written atomically: the application first writes to a temporary file in the same directory, then renames it over the real state file, so that a crash mid-write never leaves the state file in a partially-written state.
- **Trigger**: The scrape process (full or incremental) reaches its normal completion point or a recoverable partial completion.
- **Input**: The in-memory collection of all resource state entries accumulated during the run, plus any pre-existing state entries that were not visited during the run (carried forward unchanged).
- **Output / Outcome**: The state file at `<output-dir>/.moodle-sync-state.json` contains a valid UTF-8 encoded JSON array. Every resource that was downloaded or checked during the run has an up-to-date entry. Pre-existing entries for resources not visited during the run are preserved verbatim. The file is pretty-printed with 2-space indentation. The modification time of the file on disk reflects the time of the completed run.
- **Error Conditions**:
  - Disk full during state file write: the temporary file write fails; the application prints `ERROR: could not write state file — disk full` to stderr; the existing state file is left untouched; the process exits with code 3.
  - Output directory does not exist at write time: the application prints `ERROR: output directory <path> does not exist` to stderr and exits with code 3.
  - State file contains invalid JSON on read (corruption): see REQ-SYNC-001 Rule RULE-SYNC-001-C for recovery behaviour.
  - Rename of temporary file fails (permissions): the application prints `ERROR: could not finalise state file — permission denied` to stderr and exits with code 3.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: State file is written after a successful full scrape
    Given the output directory exists and is writable
    And no state file exists yet
    When the user runs a full scrape that downloads 5 resources
    Then a file named .moodle-sync-state.json is created in the output directory
    And the file contains a JSON array with exactly 5 entries
    And each entry has the fields resourceId, localPath, lastModified, contentHash, downloadedAt, status
    And each status field equals "ok"
    And each contentHash is a 64-character lowercase hex string

  Scenario: State file is updated after an incremental run
    Given a valid state file already exists with 5 entries all having status "ok"
    And 2 of those resources have changed on Moodle
    And 1 new resource has been added to Moodle
    When the user runs an incremental scrape
    Then the state file is updated atomically
    And it contains 6 entries total
    And the 2 changed resources have updated contentHash, lastModified, and downloadedAt values
    And the 1 new resource has a new entry with status "ok"
    And the 3 unchanged resources retain their previous entry values exactly

  Scenario: State file write fails due to disk full
    Given the output directory exists
    And the disk is full
    When the scrape run attempts to write the state file
    Then the process prints "ERROR: could not write state file — disk full" to stderr
    And the process exits with code 3
    And the pre-existing state file is unchanged
  ```
- **Rules**:
  - RULE-SYNC-001-A: The state file must be written atomically via a write-then-rename sequence; the temporary file must reside in the same directory as the final state file to guarantee the rename is on the same filesystem.
  - RULE-SYNC-001-B: The `contentHash` field must be computed from the bytes of the file as written to disk, after any content decoding (e.g., gzip decompression) performed by the HTTP client.
  - RULE-SYNC-001-C: If the existing state file contains invalid JSON when read at the start of a run, the application prints a warning `WARN: state file is corrupt — treating as empty` to stderr, treats the state as empty (equivalent to a first run), and proceeds; it overwrites the corrupt file at the end of the run.
  - RULE-SYNC-001-D: The `downloadedAt` timestamp must be recorded in UTC and formatted as `YYYY-MM-DDTHH:MM:SSZ` (second precision, no milliseconds).
  - RULE-SYNC-001-E: The `localPath` field must use forward slashes as the path separator regardless of the host operating system.
- **Dependencies**: REQ-SCRAPE-001, REQ-FS-001

---

### REQ-SYNC-002: State File Location
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The state file must always be stored at the fixed path `<output-dir>/.moodle-sync-state.json`, where `<output-dir>` is the resolved absolute path of the output directory for the current run. The file must never be placed inside a course subfolder or any other subdirectory of the output directory. The filename `.moodle-sync-state.json` must never be configurable by the user. The project repository's `.gitignore` file must contain an entry that prevents the state file from being committed to version control, and the application must verify at startup that this entry exists and warn the user if it does not.
- **Trigger**: Application startup and any state file read or write operation.
- **Input**: The resolved absolute path of the output directory (from CLI argument or default).
- **Output / Outcome**: All state file read and write operations target exactly `<output-dir>/.moodle-sync-state.json`. No state file appears anywhere else in the directory tree.
- **Error Conditions**:
  - Output directory path resolves to a file (not a directory): the application prints `ERROR: output path <path> is not a directory` to stderr and exits with code 2.
  - `.gitignore` entry is missing: the application prints `WARN: .moodle-sync-state.json is not listed in .gitignore — add it to avoid committing sync state` to stderr, then continues normally.
  - State file path would escape the output directory (e.g., via symlink): the application detects this via path canonicalisation and exits with code 2 with the message `ERROR: resolved state file path escapes output directory`.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: State file is created at the correct location
    Given the output directory is /home/user/moodle-output
    When a scrape run completes
    Then the state file exists at /home/user/moodle-output/.moodle-sync-state.json
    And no file named .moodle-sync-state.json exists in any subdirectory of /home/user/moodle-output

  Scenario: .gitignore entry is missing
    Given the project .gitignore does not contain .moodle-sync-state.json
    When the application starts
    Then the application prints a warning containing ".moodle-sync-state.json is not listed in .gitignore" to stderr
    And the application continues to run normally

  Scenario: Output path is a file, not a directory
    Given the path /home/user/moodle-output exists as a regular file
    When the user runs the application with --output /home/user/moodle-output
    Then the application prints "ERROR: output path /home/user/moodle-output is not a directory" to stderr
    And the application exits with code 2
  ```
- **Rules**:
  - RULE-SYNC-002-A: The state file name is the hard-coded literal `.moodle-sync-state.json`; no CLI flag or configuration option may change it.
  - RULE-SYNC-002-B: The application must check for the `.gitignore` entry at startup on every run, not only on first run.
  - RULE-SYNC-002-C: Path resolution must use the OS canonical path (resolving symlinks and `..` segments) before constructing the state file path, to prevent path traversal.
- **Dependencies**: REQ-CLI-001, REQ-FS-001

---

### REQ-SYNC-003: Change Detection on Incremental Run
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: During an incremental run, for each Moodle resource encountered the application must determine whether the remote content has changed since the last download using a two-stage strategy. Stage 1: if the HTTP response for the resource includes a `Last-Modified` header, compare its parsed UTC value against the `lastModified` value stored in the state file entry for that resource. If the remote `Last-Modified` is strictly later than the stored value, the resource is marked for re-download. Stage 2: if the HTTP response does not include a `Last-Modified` header (or if the stored `lastModified` is `null`), the application must fetch the full response body, compute its SHA-256 hash, and compare it against the stored `contentHash`. If the hashes differ, the resource is marked for re-download. Fallback: if the response provides neither a `Last-Modified` header nor sufficient content to compute a hash (e.g., a redirect chain with no body), the resource is always marked for re-download. A resource is not re-downloaded if Stage 1 determines the remote `Last-Modified` is equal to or earlier than the stored value, even if Stage 2 would indicate a change.
- **Trigger**: An incremental scrape run is initiated (no `--force` flag) and a resource already has an entry in the state file.
- **Input**: For each resource: the HTTP response headers (specifically `Last-Modified`), the response body bytes, the existing state file entry (`lastModified`, `contentHash`).
- **Output / Outcome**: Resources whose content has not changed are skipped (not written to disk, but their `downloadedAt` is not updated). Resources whose content has changed are re-downloaded, written to disk, and their state entry is updated with new `lastModified`, `contentHash`, and `downloadedAt` values.
- **Error Conditions**:
  - `Last-Modified` header value cannot be parsed as an HTTP date: the application falls through to Stage 2 (hash comparison) and logs `WARN: unparseable Last-Modified header for resource <resourceId>: <raw-value>` to stderr.
  - Network error while fetching response body for hash computation: handled per REQ-ERR-001 retry policy; if retries are exhausted the resource is skipped for this run with a warning, and its state entry is not modified.
  - Stored `contentHash` in the state file is not a valid 64-character hex string: the application treats the stored hash as absent and falls back to always re-downloading the resource, logging `WARN: invalid stored hash for resource <resourceId> — will re-download`.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Resource has a newer Last-Modified header
    Given an incremental run is in progress
    And the state file entry for resource "res-42" has lastModified "2024-11-01T10:00:00Z"
    And the HTTP response for resource "res-42" has Last-Modified "Fri, 15 Nov 2024 08:00:00 GMT"
    When change detection is performed for resource "res-42"
    Then the resource is marked for re-download
    And the resource is fetched and written to disk
    And the state entry is updated with lastModified "2024-11-15T08:00:00Z"

  Scenario: Resource has an identical Last-Modified header
    Given an incremental run is in progress
    And the state file entry for resource "res-42" has lastModified "2024-11-15T08:00:00Z"
    And the HTTP response for resource "res-42" has Last-Modified "Fri, 15 Nov 2024 08:00:00 GMT"
    When change detection is performed for resource "res-42"
    Then the resource is not re-downloaded
    And the state entry for resource "res-42" is unchanged

  Scenario: Resource has no Last-Modified header and hash has changed
    Given an incremental run is in progress
    And the state file entry for resource "res-7" has lastModified null and contentHash "aabbcc..."
    And the HTTP response for resource "res-7" has no Last-Modified header
    And the SHA-256 hash of the response body does not equal "aabbcc..."
    When change detection is performed for resource "res-7"
    Then the resource is marked for re-download and written to disk
    And the state entry is updated with the new contentHash and downloadedAt

  Scenario: Resource has no Last-Modified header and hash is unchanged
    Given an incremental run is in progress
    And the state file entry for resource "res-7" has lastModified null and contentHash "aabbcc..."
    And the HTTP response for resource "res-7" has no Last-Modified header
    And the SHA-256 hash of the response body equals "aabbcc..."
    When change detection is performed for resource "res-7"
    Then the resource is not re-downloaded
    And the state entry for resource "res-7" is unchanged
  ```
- **Rules**:
  - RULE-SYNC-003-A: Stage 1 (Last-Modified comparison) must be attempted before Stage 2 (hash comparison); Stage 2 is only reached if the `Last-Modified` header is absent or unparseable.
  - RULE-SYNC-003-B: The `Last-Modified` header must be parsed according to RFC 7231 Section 7.1.1.1 (HTTP-date format); times must be compared as UTC.
  - RULE-SYNC-003-C: When Stage 2 requires fetching the full response body solely for hash computation and no re-download is needed, the fetched bytes must not be written to disk; the existing local file is retained.
  - RULE-SYNC-003-D: "Strictly later" means the remote timestamp is at least 1 second after the stored timestamp.
- **Dependencies**: REQ-SYNC-001, REQ-SCRAPE-001, REQ-ERR-001

---

### REQ-SYNC-004: New File Detection
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: During any scrape run (full or incremental), if a resource is discovered on Moodle and there is no entry in the state file whose `resourceId` matches the resource's Moodle item ID, the resource is unconditionally treated as new and downloaded without performing any change-detection check. After download, a new state entry is created for the resource with `status` set to `"ok"`.
- **Trigger**: A resource is encountered during course enumeration and its `resourceId` is absent from the in-memory state map loaded at the start of the run.
- **Input**: The resource's Moodle item ID, the current in-memory state map (keyed by `resourceId`).
- **Output / Outcome**: The resource is downloaded and saved to its correct local path under the output directory. A new entry is added to the state map with all five fields populated and `status` `"ok"`.
- **Error Conditions**:
  - Download fails (network error): handled per REQ-ERR-001 retry policy; if retries are exhausted the resource is skipped for this run and no state entry is created for it, so it will be retried as "new" on the next run.
  - Local path conflict (a file already exists at the target path with a different `resourceId`): the application prints `WARN: path conflict for resource <resourceId> at <path> — existing file overwritten` and proceeds with the download, overwriting the file.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: New resource with no existing state entry is downloaded
    Given an incremental run is in progress
    And the state file contains no entry with resourceId "res-99"
    And resource "res-99" is present on the Moodle course page
    When the scraper processes resource "res-99"
    Then resource "res-99" is downloaded unconditionally
    And a new state entry is created for "res-99" with status "ok"
    And the contentHash, localPath, downloadedAt, and lastModified fields are all populated

  Scenario: New resource download fails after retries
    Given an incremental run is in progress
    And the state file contains no entry with resourceId "res-99"
    And all download attempts for resource "res-99" fail with a network error
    When the scraper processes resource "res-99"
    Then no state entry is created for "res-99"
    And a warning is printed to stderr naming the resource and the error
    And the run continues processing remaining resources
  ```
- **Rules**:
  - RULE-SYNC-004-A: The lookup to determine whether a resource is "new" must use the `resourceId` field only; the `localPath` must not be used as the lookup key.
  - RULE-SYNC-004-B: A resource is considered new if and only if its `resourceId` is absent from the state map; a resource whose state entry has `status` `"orphan"` is not considered new — it is treated by REQ-SYNC-005.
- **Dependencies**: REQ-SYNC-001, REQ-SCRAPE-001, REQ-ERR-001

---

### REQ-SYNC-005: Orphaned Local File Handling
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: During an incremental run, after the full list of resources currently present on a Moodle course has been enumerated, the application must compare that list against the state file entries for that course. Any resource that has an entry in the state file with `status` `"ok"` but whose `resourceId` does not appear in the current enumeration result is considered orphaned. For each orphaned resource: (1) the `status` field of its state entry must be updated to `"orphan"`; (2) the local file on disk must not be moved, renamed, or deleted; (3) a warning line must be printed to stderr in the format `WARN: orphaned resource "<name>" — no longer on Moodle, kept at <localPath>`. Resources that are already `"orphan"` in the state file and are still absent from Moodle must remain `"orphan"` and must not produce a duplicate warning on subsequent runs.
- **Trigger**: Completion of resource enumeration for a course during an incremental run; the enumerated resource ID set is compared to the state file entries for that course.
- **Input**: The set of `resourceId` values returned by the current course enumeration, the set of state file entries for the same course (filtered by course), each entry's `resourceId`, `localPath`, display name, and current `status`.
- **Output / Outcome**: State entries for missing resources have `status` `"orphan"`. Local files are intact. One warning line per newly-orphaned resource is printed to stderr. No warnings are printed for resources that were already `"orphan"`.
- **Error Conditions**:
  - The local file for an orphaned resource has already been deleted externally: the application still updates the state entry to `"orphan"` and prints the warning; it does not treat the missing file as an error.
  - The display name of the orphaned resource is unavailable (not stored in state): the warning uses the `resourceId` in place of the name: `WARN: orphaned resource <resourceId> — no longer on Moodle, kept at <localPath>`.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: A previously downloaded resource is removed from Moodle
    Given an incremental run is in progress for course "CS101"
    And the state file contains an entry for resource "res-55" with status "ok" and localPath "CS101/slides.pdf"
    And resource "res-55" is no longer present in the Moodle course "CS101"
    When orphan detection is performed after enumeration
    Then the state entry for "res-55" has its status updated to "orphan"
    And the file at "<output-dir>/CS101/slides.pdf" is not modified or deleted
    And a warning "WARN: orphaned resource \"slides.pdf\" — no longer on Moodle, kept at CS101/slides.pdf" is printed to stderr

  Scenario: Already-orphaned resource remains absent on a subsequent run
    Given an incremental run is in progress for course "CS101"
    And the state file contains an entry for resource "res-55" with status "orphan"
    And resource "res-55" is still absent from Moodle
    When orphan detection is performed
    Then the state entry for "res-55" retains status "orphan"
    And no warning is printed for "res-55"

  Scenario: Orphaned resource's local file has been manually deleted
    Given an incremental run is in progress
    And the state file contains an entry for resource "res-66" with status "ok"
    And resource "res-66" is absent from Moodle
    And the local file for "res-66" has been deleted from disk
    When orphan detection is performed
    Then the state entry for "res-66" has its status updated to "orphan"
    And no error is raised about the missing local file
    And the warning is still printed to stderr
  ```
- **Rules**:
  - RULE-SYNC-005-A: Auto-deletion of local files is strictly prohibited; no flag or configuration option may enable it.
  - RULE-SYNC-005-B: The orphan warning must be printed to stderr, not stdout.
  - RULE-SYNC-005-C: The transition from `"ok"` to `"orphan"` must occur at most once per resource per run; if a resource is listed multiple times in the state file (a corrupt state), only the first matching entry is updated.
  - RULE-SYNC-005-D: The display name used in the warning message must be the human-readable resource name as shown in Moodle, stored in the state entry; the state entry schema must therefore include a `displayName` string field in addition to the five fields listed in REQ-SYNC-001.
- **Dependencies**: REQ-SYNC-001, REQ-SCRAPE-001

---

### REQ-SYNC-006: New Course Detection
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: During an incremental run, the application must compare the list of courses currently visible on the user's Moodle dashboard (i.e., enrolled courses) against the set of courses represented in the state file. A course is considered "known" to the state file if at least one state entry has a `localPath` that begins with the course's folder name. A course that appears on the dashboard but is not known to the state file is treated as new. For every new course, the application must perform a full scrape of that course — enumerating all sections and all resource types — exactly as it would during a first full run for that course, then add state entries for all downloaded resources.
- **Trigger**: An incremental run is initiated and the dashboard course list is fetched; a course ID is found that has no corresponding entries in the state file.
- **Input**: The list of enrolled course objects returned by Moodle (each with a course ID and course name), the current state file contents.
- **Output / Outcome**: All resources in the new course are downloaded and stored under the correct output subdirectory. State entries for all new course resources are added with `status` `"ok"`. A log line `INFO: new course detected "<courseName>" — performing full scrape` is printed to stdout.
- **Error Conditions**:
  - Full scrape of the new course fails partway through (network error): the application applies the standard retry policy (REQ-ERR-001); partial state entries for successfully downloaded resources are saved; the run continues with remaining courses; a warning is printed identifying the course and the point of failure.
  - The new course has no accessible sections or resources: the application prints `INFO: new course "<courseName>" has no accessible resources — nothing to download` and adds no state entries.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: A new course appears in the dashboard
    Given an incremental run is in progress
    And the state file contains no entries for course "Math202"
    And "Math202" appears in the user's Moodle dashboard
    When new course detection is performed
    Then "INFO: new course detected \"Math202\" — performing full scrape" is printed to stdout
    And all resources in "Math202" are downloaded
    And state entries are created for each downloaded resource with status "ok"

  Scenario: New course has no accessible resources
    Given an incremental run is in progress
    And the state file contains no entries for course "EmptyCourse"
    And "EmptyCourse" appears on the dashboard with zero accessible resources
    When new course detection is performed
    Then "INFO: new course \"EmptyCourse\" has no accessible resources — nothing to download" is printed to stdout
    And no state entries are created for "EmptyCourse"
  ```
- **Rules**:
  - RULE-SYNC-006-A: A "full scrape" of a new course during an incremental run must follow the same enumeration logic as REQ-SCRAPE-001 — all sections, all resource types — without shortcuts.
  - RULE-SYNC-006-B: The presence of a course is determined by the course ID as returned by Moodle, not by the folder name on disk, to avoid false negatives caused by filesystem name sanitisation.
  - RULE-SYNC-006-C: The state file must be updated with the new course's entries before the application exits, even if the full run is interrupted after the new course scrape completes.
- **Dependencies**: REQ-SYNC-001, REQ-SCRAPE-001, REQ-AUTH-001, REQ-ERR-001

---

### REQ-SYNC-007: Removed Course Handling
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: During an incremental run, after the enrolled course list has been fetched from the Moodle dashboard, the application must determine which courses have entries in the state file but are absent from the current dashboard list. A course is considered absent if its course ID does not appear in the dashboard response. For each absent course: (1) all state entries belonging to that course must have their `status` updated to `"orphan"`; (2) all local files belonging to that course must be left on disk untouched; (3) a single warning line must be printed to stderr in the format `WARN: course "<courseName>" is no longer in your Moodle dashboard — <N> resource(s) marked as orphan, local files kept`. On subsequent runs, already-orphaned resources from removed courses must not produce duplicate warnings.
- **Trigger**: An incremental run fetches the enrolled course list and finds that a course previously seen is no longer present.
- **Input**: The current enrolled course list (with course IDs) from the Moodle dashboard, the current state file entries (grouped or filterable by course).
- **Output / Outcome**: All state entries for the removed course have `status` `"orphan"`. Local files are undisturbed. One warning line per newly-removed course is printed to stderr. The state file is updated atomically before the application exits.
- **Error Conditions**:
  - Dashboard fetch fails (network error): the application must not mark any courses as removed based on a failed or incomplete dashboard response; it prints `ERROR: could not fetch course list — skipping removal detection` to stderr and proceeds without orphaning any courses.
  - The course name is not stored in the state file: the warning uses the course ID in place of the name: `WARN: course <courseId> is no longer in your Moodle dashboard — <N> resource(s) marked as orphan, local files kept`.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: A course is removed from the user's Moodle enrolment
    Given an incremental run is in progress
    And the state file contains 3 entries for course "OldCourse" with courseId "course-77", all with status "ok"
    And "course-77" does not appear in the current Moodle dashboard response
    When removed course detection is performed
    Then all 3 state entries for course-77 have their status set to "orphan"
    And no local files for course-77 are deleted or modified
    And the warning "WARN: course \"OldCourse\" is no longer in your Moodle dashboard — 3 resource(s) marked as orphan, local files kept" is printed to stderr

  Scenario: Already-removed course is still absent on a subsequent run
    Given an incremental run is in progress
    And the state file contains entries for "course-77" all with status "orphan"
    And "course-77" is still absent from the dashboard
    When removed course detection is performed
    Then no changes are made to the state entries for course-77
    And no warning is printed for course-77

  Scenario: Dashboard fetch fails during removed course detection
    Given an incremental run is in progress
    And the dashboard HTTP request fails with a network error after exhausting retries
    When removed course detection attempts to fetch the course list
    Then the error "ERROR: could not fetch course list — skipping removal detection" is printed to stderr
    And no state entries are modified as a result of removal detection
    And the run continues with the previously cached course list if available, or exits with code 4
  ```
- **Rules**:
  - RULE-SYNC-007-A: Removal detection must never be performed against a partial or failed dashboard response; the full course list must be confirmed as successfully fetched before any entries are orphaned.
  - RULE-SYNC-007-B: The count `<N>` in the warning message must reflect the number of entries transitioning from `"ok"` to `"orphan"` in that run; entries already `"orphan"` are excluded from the count.
  - RULE-SYNC-007-C: Auto-deletion of local files belonging to removed courses is strictly prohibited; no flag or configuration option may enable it.
- **Dependencies**: REQ-SYNC-001, REQ-SYNC-005, REQ-AUTH-001, REQ-ERR-001

---

### REQ-SYNC-008: Force Full Re-Sync Flag
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: When the user invokes the CLI with the `--force` flag, the application must bypass all change-detection logic (REQ-SYNC-003) and treat every resource currently present on Moodle as requiring a fresh download, regardless of the values stored in the state file. All resources are fetched from Moodle and written to disk, overwriting any existing local files at the same paths. After all downloads complete, the state file is fully rewritten from scratch — not merged with the previous state — containing only the entries for resources encountered during the current run. Resources that were previously `"orphan"` in the old state file and are still absent from Moodle are not included in the new state file.
- **Trigger**: The user passes the `--force` flag on the CLI invocation.
- **Input**: The `--force` flag; the currently enrolled courses and their resources as returned by Moodle; the existing local file tree (which will be overwritten where paths match).
- **Output / Outcome**: All Moodle resources are downloaded fresh. The state file is fully replaced with a new array containing only entries from the current run, all with `status` `"ok"`. A log line `INFO: force re-sync — all <N> resources will be re-downloaded` is printed to stdout before downloads begin, where `<N>` is the total resource count discovered.
- **Error Conditions**:
  - Download of an individual resource fails after retries: the resource is skipped; no state entry is written for it; a warning is printed; the run continues with remaining resources.
  - The output directory is not writable: the application prints `ERROR: output directory <path> is not writable` to stderr and exits with code 3 before any downloads begin.
  - `--force` is combined with `--dry-run`: the application prints `ERROR: --force and --dry-run are mutually exclusive` to stderr and exits with code 2.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Force re-sync re-downloads all resources
    Given the state file contains 10 entries all with status "ok"
    And all 10 resources are still present on Moodle
    When the user runs the CLI with --force
    Then "INFO: force re-sync — all 10 resources will be re-downloaded" is printed to stdout
    And all 10 resources are fetched from Moodle regardless of Last-Modified or hash
    And all 10 local files are overwritten with the freshly downloaded content
    And the state file is fully replaced with 10 new entries all with status "ok" and updated downloadedAt values

  Scenario: Force re-sync with a previously orphaned resource now absent
    Given the state file contains 8 "ok" entries and 2 "orphan" entries for resources no longer on Moodle
    When the user runs the CLI with --force
    Then the 8 active resources are re-downloaded
    And the new state file contains exactly 8 entries
    And no entries exist for the 2 previously orphaned resources

  Scenario: --force and --dry-run flags are both passed
    Given the user passes both --force and --dry-run on the command line
    When the application parses its arguments
    Then it prints "ERROR: --force and --dry-run are mutually exclusive" to stderr
    And it exits with code 2
    And no downloads are performed and no files are modified
  ```
- **Rules**:
  - RULE-SYNC-008-A: The `--force` flag must cause all change-detection logic to be skipped entirely; the application must not read `lastModified` or `contentHash` from the state file during a force run.
  - RULE-SYNC-008-B: The state file rewrite after a force run must be a full replacement, not an update; the previous state file content must be discarded after the new one is atomically written.
  - RULE-SYNC-008-C: The `--force` flag must not change the output directory structure or file naming conventions; files are written to the same paths as a normal run.
- **Dependencies**: REQ-SYNC-001, REQ-SYNC-003, REQ-CLI-001, REQ-SCRAPE-001, REQ-ERR-001

---

### REQ-SYNC-009: Dry-Run Mode
- **Type**: Functional
- **Priority**: Should-Have
- **Description**: When the user invokes the CLI with the `--dry-run` flag, the application must perform all enumeration and change-detection logic (including fetching resource metadata and computing hashes where necessary) but must not write, modify, or delete any file on disk — neither content files nor the state file. At the end of the dry run, the application must print a human-readable summary to stdout that lists: (1) the number of new resources that would be downloaded; (2) the number of existing resources that would be re-downloaded due to a detected change; (3) the number of resources that are unchanged and would be skipped; (4) the number of resources that would be newly orphaned; (5) the number of new courses that would be fully scraped. The summary must also list the names and local paths of all resources in categories 1, 2, and 4 (one per line). The process exits with code 0 in all cases where enumeration and detection succeed.
- **Trigger**: The user passes the `--dry-run` flag on the CLI invocation.
- **Input**: The `--dry-run` flag; the current Moodle course and resource list; the current state file (read-only during this run).
- **Output / Outcome**: No files are created, modified, or deleted. The state file is unchanged. A summary is printed to stdout. Exit code is 0 on success.
- **Error Conditions**:
  - Enumeration or metadata fetch fails (network error): the application prints a warning per failing resource to stderr; the summary notes that results may be incomplete with the line `WARN: dry-run results may be incomplete due to fetch errors`; the process still exits with code 0.
  - `--dry-run` combined with `--force`: the application prints `ERROR: --force and --dry-run are mutually exclusive` to stderr and exits with code 2 (handled in REQ-SYNC-008).
  - State file is corrupt or missing: the application treats the state as empty (per RULE-SYNC-001-C) and continues the dry run; all resources are reported as "would be downloaded (new)".
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Dry run with a mix of new, changed, and unchanged resources
    Given the state file contains 5 entries: 3 unchanged, 1 changed (newer Last-Modified), 1 orphaned
    And 1 additional resource is present on Moodle with no state entry (new)
    When the user runs the CLI with --dry-run
    Then no files are written or modified on disk
    And the state file is not modified
    And the stdout summary contains:
      | would download (new):     1 |
      | would re-download (changed): 1 |
      | unchanged (skip):         3 |
      | would orphan:             1 |
      | new courses:              0 |
    And the names and paths of the 1 new and 1 changed and 1 orphaned resource are listed
    And the process exits with code 0

  Scenario: Dry run when all resources are up to date
    Given the state file contains 7 entries all matching the current Moodle content
    When the user runs the CLI with --dry-run
    Then no files are written or modified on disk
    And the stdout summary reports: would download (new): 0, would re-download (changed): 0, unchanged (skip): 7, would orphan: 0
    And the process exits with code 0

  Scenario: Dry run with a network error during metadata fetch
    Given the user runs the CLI with --dry-run
    And fetching metadata for resource "res-11" fails with a network error after retries
    When the dry run processes resource "res-11"
    Then a warning is printed to stderr for "res-11"
    And the summary includes "WARN: dry-run results may be incomplete due to fetch errors"
    And the process exits with code 0
  ```
- **Rules**:
  - RULE-SYNC-009-A: During a dry run, the application must not open any file on disk in write mode; all filesystem interactions must be read-only (reading the state file and reading existing local files for hash computation if needed).
  - RULE-SYNC-009-B: The dry-run summary must be printed to stdout as the final output of the run, after all warnings (which go to stderr).
  - RULE-SYNC-009-C: Hash computation during a dry run for Stage 2 change detection (REQ-SYNC-003) requires fetching the remote content body; this fetch is permitted because it is a network read, not a filesystem write. The fetched bytes must be discarded after hashing and must not be written to disk.
  - RULE-SYNC-009-D: Exit code 0 is returned on all successful dry-run completions, including those with warnings about incomplete results.
- **Dependencies**: REQ-SYNC-001, REQ-SYNC-003, REQ-SYNC-004, REQ-SYNC-005, REQ-SYNC-006, REQ-SYNC-007, REQ-CLI-001

---

## Filesystem & Output Structure

### REQ-FS-001: Root Output Directory
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The tool writes all scraped content under a single root output directory. The default is `./output/` resolved relative to the current working directory at the time the command is invoked. The path can be overridden at runtime via the `--output <path>` CLI flag or the `outputDir` key in the config file. If the resolved directory does not exist, the tool creates it (including any missing intermediate directories) before any downloads begin. No manual setup is required from the user.
- **Trigger**: The user invokes the CLI (with or without `--output`).
- **Input**: Optionally, `--output <path>` CLI flag or `outputDir: <path>` config key. If neither is provided, the default `./output/` is used.
- **Output / Outcome**: The resolved output directory exists on the filesystem before the first file is written. A log entry "Using output directory: <resolved-absolute-path>" is emitted at INFO level.
- **Error Conditions**:
  - Directory cannot be created (permission denied): abort with exit code 2 and message "Cannot create output directory: <path> — <OS error>".
  - Resolved path exists but is a file, not a directory: abort with exit code 2 and message "Output path is not a directory: <path>".
  - Resolved path is on a read-only filesystem: abort with exit code 2 and message "Output directory is not writable: <path>".
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Default output directory is created automatically
    Given no --output flag is provided
    And ./output/ does not exist
    When the user runs the scraper
    Then ./output/ is created before any file is written
    And the log contains "Using output directory: <absolute-path-to-output>"

  Scenario: Custom output directory via --output flag
    Given the user passes --output /tmp/my-scrape
    And /tmp/my-scrape does not exist
    When the user runs the scraper
    Then /tmp/my-scrape is created before any file is written
    And the log contains "Using output directory: /tmp/my-scrape"

  Scenario: Output path exists as a file
    Given a file exists at ./output
    When the user runs the scraper without --output
    Then the program exits with code 2
    And stderr contains "Output path is not a directory: <path>"
  ```
- **Rules**:
  - RULE-FS-001-A: The output directory is resolved to an absolute path before use; all subsequent path operations use the absolute form.
  - RULE-FS-001-B: Directory creation uses a recursive / mkdirp-style call so that deeply nested paths are created in a single operation.
  - RULE-FS-001-C: Writability is verified by attempting to create and immediately delete a zero-byte probe file named `.write-check` inside the directory before any downloads begin.
- **Dependencies**: REQ-CLI-001 (--output flag definition)

---

### REQ-FS-002: Folder Hierarchy
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: All downloaded files are organised into a deterministic three-level directory tree under the root output directory. The structure is: `<output-dir>/<sanitised-course-name>/<zero-padded-section-number>_<sanitised-section-name>/<filename>`. Section numbers are zero-padded to exactly 2 digits (e.g. `01_Introduction`, `09_Wrap_Up`, `10_Advanced_Topics`). Section numbering follows the order in which sections appear in the Moodle course page, starting at 1. A section numbered 0 in Moodle (the course header section) is mapped to folder `00_<sanitised-section-name>`. Files whose Moodle section number exceeds 99 are padded to the minimum number of digits required to represent the highest section number in that course (e.g. if a course has 120 sections, all numbers are padded to 3 digits: `001_`, `010_`, `120_`).
- **Trigger**: The scraper is about to write a downloaded file to disk.
- **Input**: Resolved output directory path, course name string, section index integer, section name string, filename string (all as returned by the scraper / sanitiser).
- **Output / Outcome**: The full directory path `<output-dir>/<sanitised-course-name>/<padded-section>_<sanitised-section-name>/` exists and the file is placed inside it.
- **Error Conditions**:
  - Any path component is empty after sanitisation: abort that file with a WARN log "Skipping file <original-name>: path component resolved to empty string after sanitisation" and continue with the next file.
  - Directory creation fails (permission, disk full, etc.): treat as a write error per REQ-FS-005.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Standard two-digit section number
    Given a course named "Business Informatics I"
    And section number 3 named "Data Models"
    And a file named "lecture3.pdf"
    When the file is written to disk
    Then it is placed at <output-dir>/Business_Informatics_I/03_Data_Models/lecture3.pdf

  Scenario: Section number zero (course header)
    Given a course named "Business Informatics I"
    And section number 0 named "General"
    And a file named "syllabus.pdf"
    When the file is written to disk
    Then it is placed at <output-dir>/Business_Informatics_I/00_General/syllabus.pdf

  Scenario: Section number exceeds 99
    Given a course with 120 sections
    And section number 5 named "Intro"
    When a file in that section is written to disk
    Then the folder is named "005_Intro"

  Scenario: Section name is empty after sanitisation
    Given a section whose name sanitises to an empty string
    When a file in that section is about to be written
    Then the file is skipped with WARN "Skipping file <name>: path component resolved to empty string after sanitisation"
    And the program continues to the next file
  ```
- **Rules**:
  - RULE-FS-002-A: Zero-padding width is computed per-course, not globally; each course independently determines the minimum pad width needed for its own section count.
  - RULE-FS-002-B: The separator between the zero-padded number and the section name is always a single underscore `_`.
  - RULE-FS-002-C: Course name and section name are independently processed through the sanitiser defined in REQ-FS-003 before being used as path components.
- **Dependencies**: REQ-FS-001, REQ-FS-003, REQ-SCRAPE-001

---

### REQ-FS-003: Filename Sanitisation
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: Every string used as a file or folder name component — course name, section name, and filename — is passed through a sanitisation function before being written to the filesystem. The function must produce names that are safe on macOS (HFS+/APFS), Linux (ext4/xfs), and Windows (NTFS/FAT32). The sanitisation steps are applied in the following fixed order: (1) strip the characters `/ \ : * ? " < > | NUL` (where NUL is the null byte U+0000) by replacing each with `_`; (2) collapse runs of two or more consecutive underscores into a single `_`; (3) strip leading and trailing ASCII space characters (U+0020) and dot characters (`.`); (4) for filenames (not directory name components), split on the last `.` to separate name from extension; truncate the name portion to 200 characters maximum; if truncation occurs, log a DEBUG message "Filename truncated: '<original>' → '<truncated>.<ext>'"; (5) if the result is empty after all steps, substitute the string `_unnamed_`.
- **Trigger**: Any path component (course name, section name, or filename) is derived from Moodle data and is about to be used in a filesystem path.
- **Input**: A raw Unicode string from Moodle (course name, section title, or resource filename).
- **Output / Outcome**: A sanitised string that contains no characters from the forbidden set, has no leading/trailing spaces or dots, has no consecutive underscores, and whose name portion (excluding extension) does not exceed 200 characters.
- **Error Conditions**:
  - Input string is null or undefined: treat as empty string, apply step 5, return `_unnamed_`.
  - Input string consists entirely of forbidden characters / spaces / dots such that the result after all steps is empty: return `_unnamed_`.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Forbidden characters are replaced
    Given the raw string "Report: Q1/Q2 Results?.pdf"
    When sanitised as a filename
    Then the result is "Report_ Q1_Q2 Results_.pdf"
    And after underscore collapsing the name portion is "Report_ Q1_Q2 Results_"

  Scenario: Leading/trailing spaces and dots are stripped
    Given the raw string "  ..My File..  "
    When sanitised
    Then the result is "My File"

  Scenario: Consecutive underscores are collapsed
    Given the raw string "A//B\\C"
    When sanitised
    Then the forbidden characters are replaced yielding "A__B__C"
    And after collapsing the result is "A_B_C"

  Scenario: Name portion exceeds 200 characters
    Given a filename whose name portion (before the last ".") is 250 characters long
    When sanitised
    Then the name portion in the result is exactly 200 characters
    And the extension is preserved unchanged
    And a DEBUG log entry "Filename truncated: ..." is emitted

  Scenario: String becomes empty after sanitisation
    Given the raw string "///:*"
    When sanitised
    Then the result is "_unnamed_"
  ```
- **Rules**:
  - RULE-FS-003-A: The forbidden character set is exactly: `/ \ : * ? " < > | \u0000`. No other characters are removed or replaced by the sanitiser.
  - RULE-FS-003-B: Unicode characters outside the ASCII forbidden set (e.g. accented letters, CJK characters) are preserved as-is; the sanitiser does not transliterate.
  - RULE-FS-003-C: The 200-character truncation limit applies only to the name stem (the part before the last `.`). The extension (including the `.`) is appended in full after truncation and does not count toward the 200-character limit.
  - RULE-FS-003-D: The sanitiser is a pure function (no side effects other than the DEBUG log on truncation); it must be unit-testable in isolation.
  - RULE-FS-003-E: Windows reserved filenames (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) — if the sanitised name stem matches one of these (case-insensitive) — are suffixed with `_` (e.g. `NUL` → `NUL_`, `com1.txt` → `com1_.txt`).
- **Dependencies**: none

---

### REQ-FS-004: Filename Collision Handling
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: When the scraper is about to write a file to a path that already exists on disk and the existing file's SHA-256 hash differs from the SHA-256 hash of the incoming content, the scraper must not overwrite the existing file. Instead, it appends a numeric suffix before the file extension, starting at `_2`, incrementing by 1 until it finds a path that either does not exist or whose on-disk content has the same SHA-256 hash as the incoming content (in which case the file is considered already present and is skipped). There is no upper bound enforced on the suffix counter, but a WARN log is emitted if the counter exceeds 99. If the existing file's SHA-256 hash is identical to the incoming content, the file is silently skipped (treated as already up-to-date).
- **Trigger**: The scraper resolves the final destination path for a downloaded file and finds a file already at that path.
- **Input**: Resolved destination path string, downloaded file content (bytes).
- **Output / Outcome**: Either (a) the file is written to a new non-colliding path of the form `<stem>_<N><ext>`, or (b) an identical file already exists and no write occurs. The path that was actually written (or skipped) is logged at DEBUG level.
- **Error Conditions**:
  - Hash computation of an existing on-disk file fails (e.g. permission denied reading the file): log WARN "Cannot read existing file for hash comparison: <path> — skipping download" and skip the incoming file without writing.
  - Suffix counter exceeds 99: emit WARN "High collision count (<N>) for file <original-path> — check for duplicate downloads".
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Destination does not exist — write directly
    Given the destination path does not exist
    When the scraper writes a file
    Then the file is written at the original destination path
    And no suffix is appended

  Scenario: Destination exists with identical content
    Given a file exists at the destination path
    And its SHA-256 hash equals the hash of the incoming content
    When the scraper attempts to write the file
    Then no file is written
    And a DEBUG log "File already up-to-date: <path>" is emitted

  Scenario: Destination exists with different content
    Given a file exists at the destination path
    And its SHA-256 hash differs from the hash of the incoming content
    When the scraper attempts to write the file
    Then the file is written at <stem>_2<ext>
    And the original file is not modified

  Scenario: _2 also exists with different content
    Given files exist at <stem><ext> and <stem>_2<ext>, both with differing hashes from the incoming content
    When the scraper attempts to write the file
    Then the file is written at <stem>_3<ext>
  ```
- **Rules**:
  - RULE-FS-004-A: The suffix is inserted immediately before the file extension: `report.pdf` → `report_2.pdf`. For files with no extension, the suffix is appended to the end: `README` → `README_2`.
  - RULE-FS-004-B: SHA-256 is the hash algorithm used for all content comparison in this requirement. No other algorithm is acceptable.
  - RULE-FS-004-C: The hash of the incoming content is computed once in memory from the fully downloaded bytes before any collision check begins; it is not recomputed on each iteration.
  - RULE-FS-004-D: Collision suffix numbering starts at 2 (not 1) so that the un-suffixed file and `_2` are semantically "first" and "second" copy respectively.
- **Dependencies**: REQ-FS-003, REQ-FS-005

---

### REQ-FS-005: Atomic File Writes
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: Every file download is written via a two-phase atomic protocol to prevent corrupt or partial files from persisting on disk after an interrupted run. Phase 1: write the downloaded bytes to a temporary file at `<final-absolute-path>.part`. Phase 2: on successful completion of the write, rename the `.part` file to the final filename using an atomic OS rename (which replaces the destination if it exists). On any failure during Phase 1 (write error, network interruption, process signal, or exception), the `.part` file must be deleted before the error propagates. The final filename is never written directly; only the rename step produces it.
- **Trigger**: The scraper begins writing a downloaded resource to disk.
- **Input**: Final destination path (absolute), downloaded content (bytes or stream).
- **Output / Outcome**: On success — the final file exists at the destination path with complete content; no `.part` file remains. On failure — no `.part` file remains; no partial file exists at the final destination path.
- **Error Conditions**:
  - Write to `.part` file fails mid-stream (disk full, I/O error): delete the `.part` file, log ERROR "Failed to write <final-path>: <OS error>", increment the failed-download counter, continue with the next file.
  - Rename of `.part` to final path fails: delete the `.part` file, log ERROR "Failed to finalise <final-path>: <OS error>", increment the failed-download counter.
  - Deletion of `.part` file itself fails after a write error: log ERROR "Failed to delete incomplete file <path>.part: <OS error>" and continue; the orphaned `.part` file will be cleaned up on the next startup per REQ-FS-006.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Successful download produces only the final file
    Given a valid download URL
    When the file is downloaded and written
    Then the final file exists at the destination path
    And no file ending in .part exists at that path

  Scenario: Write is interrupted mid-stream
    Given a download begins writing to <path>.part
    When an I/O error occurs before the write completes
    Then the .part file is deleted
    And no file exists at <final-path>
    And an ERROR log "Failed to write <final-path>: <OS error>" is emitted

  Scenario: Rename step fails
    Given the .part file has been fully written
    When the rename to the final path fails
    Then the .part file is deleted
    And no file exists at <final-path>
    And an ERROR log "Failed to finalise <final-path>: <OS error>" is emitted
  ```
- **Rules**:
  - RULE-FS-005-A: The `.part` suffix is always appended to the full final filename including its extension: `lecture.pdf` → `lecture.pdf.part`.
  - RULE-FS-005-B: The rename operation must use the OS-level atomic rename call (e.g. `fs.rename` on POSIX, `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING` on Windows) — not a copy-then-delete sequence.
  - RULE-FS-005-C: The `.part` file is always created in the same directory as the final destination so that the rename is guaranteed to be an atomic same-filesystem operation.
  - RULE-FS-005-D: A try/finally or equivalent construct must be used to ensure `.part` deletion occurs even when an unhandled exception propagates.
- **Dependencies**: REQ-FS-001, REQ-FS-002, REQ-FS-003

---

### REQ-FS-006: Partial File Cleanup on Startup
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: Each time the scraper starts, before any scraping activity begins, it scans the entire output directory tree recursively for files whose names end with the suffix `.part`. For every such file found, it logs a WARNING at the level "Found incomplete download: <absolute-path> — deleting", then deletes the file. After the cleanup pass is complete, the corresponding resources are treated as not-yet-downloaded and will be re-fetched during the current run's normal scraping phase. The cleanup scan occurs after the output directory is created (REQ-FS-001) and after partial-file inventory is complete, but before any network requests are made.
- **Trigger**: The scraper process starts and the output directory exists (or has just been created).
- **Input**: The resolved absolute path of the output directory.
- **Output / Outcome**: Zero `.part` files remain anywhere in the output directory tree after the cleanup pass. Each deleted file produces one WARN log line. A summary INFO log "Startup cleanup: deleted <N> incomplete file(s)" is emitted (N=0 is valid and should still be logged at DEBUG level rather than INFO when N=0).
- **Error Conditions**:
  - A `.part` file cannot be deleted (permission denied, file locked): log ERROR "Failed to delete incomplete file <path>: <OS error>" and continue scanning; do not abort startup.
  - The output directory tree cannot be scanned (e.g. permission denied on a subdirectory): log WARN "Cannot scan directory <path> for incomplete downloads: <OS error>" and continue with accessible directories.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: No .part files present at startup
    Given the output directory contains no files ending in .part
    When the scraper starts
    Then a DEBUG log "Startup cleanup: deleted 0 incomplete file(s)" is emitted
    And scraping proceeds normally

  Scenario: One .part file is found and deleted
    Given a file lecture.pdf.part exists in the output directory tree
    When the scraper starts
    Then a WARN log "Found incomplete download: <absolute-path> — deleting" is emitted
    And the file is deleted
    And an INFO log "Startup cleanup: deleted 1 incomplete file(s)" is emitted
    And the corresponding resource is re-downloaded in the current run

  Scenario: A .part file cannot be deleted
    Given a .part file exists but the process lacks permission to delete it
    When the scraper starts
    Then an ERROR log "Failed to delete incomplete file <path>: <OS error>" is emitted
    And startup continues
    And the remaining .part files are still processed
  ```
- **Rules**:
  - RULE-FS-006-A: The scan is recursive — it traverses all subdirectories of the output directory, not just the top level.
  - RULE-FS-006-B: Only files whose names end with exactly `.part` (case-sensitive) are targeted; files like `.partial` or `.part.bak` are not affected.
  - RULE-FS-006-C: The cleanup scan must complete fully before any network request is made.
  - RULE-FS-006-D: The set of `.part` files found during startup is logged at DEBUG level as a list before deletion begins, to aid post-mortem debugging.
- **Dependencies**: REQ-FS-001, REQ-FS-005

---

### REQ-FS-007: Optional Metadata Sidecar
- **Type**: Functional
- **Priority**: Should-Have
- **Description**: When enabled, after all files for a course have been downloaded (or skipped as up-to-date), the scraper writes a JSON metadata file at `<output-dir>/<sanitised-course-name>/.course-meta.json`. The file is regenerated on every run (not merged with a previous version). It contains exactly the following fields: `courseId` (integer — the Moodle course ID), `courseName` (string — the original unsanitised Moodle course name), `moodleUrl` (string — the full HTTPS URL of the course page on Moodle), `lastScrapedAt` (string — ISO 8601 UTC datetime of when the current scrape run completed for this course, format `YYYY-MM-DDTHH:mm:ssZ`), `totalFiles` (integer — count of files that were written or already up-to-date for this course in this run, not counting the sidecar itself). The feature is disabled by default and enabled via `--metadata` CLI flag or `metadata: true` in the config file.
- **Trigger**: The scraper finishes processing all resources for a single course, and the metadata feature is enabled.
- **Input**: `--metadata` CLI flag or `metadata: true` config key; course scraping results (courseId, courseName, moodleUrl, completion timestamp, file count).
- **Output / Outcome**: A file `.course-meta.json` exists in the course's top-level output directory, containing valid JSON with the five required fields. The file is human-readable (pretty-printed with 2-space indentation).
- **Error Conditions**:
  - Writing `.course-meta.json` fails (permission denied, disk full): log WARN "Failed to write metadata for course <courseId>: <OS error>" and continue; the scraping results are not affected.
  - A previous `.course-meta.json` exists: overwrite it unconditionally (no collision-handling; this file is always regenerated).
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Metadata disabled by default
    Given no --metadata flag is passed and metadata is not set in config
    When the scraper completes a course
    Then no .course-meta.json file is written

  Scenario: Metadata enabled via --metadata flag
    Given the user passes --metadata
    When the scraper completes course with ID 42 named "Business Informatics I"
    Then <output-dir>/Business_Informatics_I/.course-meta.json exists
    And it contains valid JSON with fields courseId=42, courseName="Business Informatics I", moodleUrl=<course-url>, lastScrapedAt=<ISO8601>, totalFiles=<integer>
    And the JSON is pretty-printed with 2-space indentation

  Scenario: Metadata write fails
    Given --metadata is enabled
    And the course output directory is not writable
    When the scraper completes a course
    Then a WARN log "Failed to write metadata for course <courseId>: <OS error>" is emitted
    And the scraper continues processing remaining courses
  ```
- **Rules**:
  - RULE-FS-007-A: The five JSON fields are written in this fixed order: `courseId`, `courseName`, `moodleUrl`, `lastScrapedAt`, `totalFiles`. No additional fields are written.
  - RULE-FS-007-B: `lastScrapedAt` is recorded in UTC and formatted as `YYYY-MM-DDTHH:mm:ssZ` (seconds precision, explicit Z suffix — not a numeric offset).
  - RULE-FS-007-C: `.course-meta.json` is written using the atomic write protocol defined in REQ-FS-005 (write to `.course-meta.json.part`, rename on success).
  - RULE-FS-007-D: `.course-meta.json` itself is never counted in the `totalFiles` field.
  - RULE-FS-007-E: If the metadata flag is enabled via config file, the `--no-metadata` CLI flag must be able to override it and disable the feature for that run.
- **Dependencies**: REQ-FS-001, REQ-FS-002, REQ-FS-003, REQ-FS-005, REQ-CLI-001

---

### REQ-FS-008: Disk Space Pre-Check
- **Type**: Non-Functional
- **Priority**: Must-Have
- **Description**: Before any file downloads begin, the scraper checks the available free disk space on the volume that contains the output directory. Two thresholds are enforced: a hard minimum of 100 MB and a soft warning threshold of 500 MB. If free space is below the soft threshold but at or above the hard minimum, the user is warned and prompted for confirmation before scraping proceeds. If free space is below the hard minimum, scraping is aborted immediately. In non-interactive mode (when `--non-interactive` flag is set or when stdout is not a TTY), the soft-threshold prompt is skipped and treated as an implicit abort (same behaviour as the hard threshold). The check is performed once at startup, after the output directory has been created and partial-file cleanup is complete, but before the first network request.
- **Trigger**: The scraper completes startup initialisation (output directory ready, cleanup done) and is about to begin downloading.
- **Input**: Resolved absolute path of the output directory; free disk space in bytes as reported by the OS for the volume containing that path.
- **Output / Outcome**: If free space >= 500 MB: scraping proceeds with no output. If 100 MB <= free space < 500 MB and interactive: a warning is printed and the user is prompted (Y/N); on Y scraping proceeds, on N the program exits with code 0 and message "Aborted by user.". If free space < 100 MB: program exits with code 4 and message "Insufficient disk space: <N> MB free, minimum 100 MB required." (where N is rounded down to the nearest integer MB). In non-interactive mode with free space < 500 MB: same exit as < 100 MB case (code 4, same message pattern).
- **Error Conditions**:
  - OS call to retrieve free disk space fails: log WARN "Cannot determine free disk space for <path>: <OS error> — proceeding without check" and continue scraping.
  - Free space exactly equals 100 MB: this is below the threshold; abort with exit code 4.
  - Free space exactly equals 500 MB: this is at (not below) the soft threshold; proceed without warning.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Sufficient disk space — no warning
    Given the output volume has 1 GB free
    When the scraper starts
    Then no disk space warning is displayed
    And scraping proceeds normally

  Scenario: Free space below 500 MB — interactive prompt
    Given the output volume has 300 MB free
    And the session is interactive (TTY)
    When the scraper starts
    Then a warning "Low disk space: 300 MB free. Continue? [Y/N]" is printed to stdout
    When the user enters "Y"
    Then scraping proceeds

  Scenario: Free space below 500 MB — user declines
    Given the output volume has 300 MB free
    And the session is interactive (TTY)
    When the scraper starts and prints the low disk space warning
    And the user enters "N"
    Then the program exits with code 0
    And stdout contains "Aborted by user."

  Scenario: Free space below 100 MB — hard abort
    Given the output volume has 80 MB free
    When the scraper starts
    Then the program exits with code 4
    And stderr contains "Insufficient disk space: 80 MB free, minimum 100 MB required."

  Scenario: Non-interactive mode with low disk space
    Given the output volume has 300 MB free
    And the session is non-interactive (--non-interactive flag set or no TTY)
    When the scraper starts
    Then the program exits with code 4
    And stderr contains "Insufficient disk space: 300 MB free, minimum 100 MB required."

  Scenario: OS cannot determine free disk space
    Given the OS disk-space API call throws an error
    When the scraper starts
    Then a WARN log "Cannot determine free disk space for <path>: <OS error> — proceeding without check" is emitted
    And scraping proceeds normally
  ```
- **Rules**:
  - RULE-FS-008-A: The hard minimum threshold is exactly 100 MB (104,857,600 bytes). "Below" means strictly less than; exactly 100 MB is below the threshold.
  - RULE-FS-008-B: The soft warning threshold is exactly 500 MB (524,288,000 bytes). "Below" means strictly less than; exactly 500 MB does not trigger the warning.
  - RULE-FS-008-C: Free space reported in warning/error messages is converted to MB by integer division by 1,048,576 (rounded down, not rounded to nearest).
  - RULE-FS-008-D: The disk space check queries the volume of the output directory, not the volume of the current working directory or the system root.
  - RULE-FS-008-E: Exit code 4 is reserved exclusively for the insufficient-disk-space abort; no other condition may use exit code 4.
  - RULE-FS-008-F: In non-interactive mode (--non-interactive or no TTY), any free space below 500 MB triggers exit code 4, making the soft and hard thresholds effectively the same.
- **Dependencies**: REQ-FS-001, REQ-FS-006, REQ-CLI-001

---

## CLI Interface & UX

### REQ-CLI-001: Command Name and Alias
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The program is installed and invoked as `moodle-scraper`. When the install method supports registering multiple binary entry points (e.g., npm `bin` field, pipx scripts, Homebrew shims), a short alias `ms` is registered alongside it pointing to the same entry point. Both names must behave identically in every respect.
- **Trigger**: User installs the program via the supported package manager or install script.
- **Input**: Shell command `moodle-scraper [args]` or `ms [args]`.
- **Output / Outcome**: The program starts and processes `[args]` identically regardless of which name was used to invoke it.
- **Error Conditions**:
  - Alias unsupported by install method: `ms` is omitted silently; `moodle-scraper` still works. No error is emitted.
  - Name collision with existing `ms` binary: installer prints a warning "Alias 'ms' skipped: name already exists on PATH." and continues installing `moodle-scraper`.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Primary command name works after install
    Given the program has been installed via the supported install method
    When the user runs "moodle-scraper --version"
    Then the program prints "moodle-scraper <semver>" and exits with code 0

  Scenario: Short alias works when install method supports it
    Given the program has been installed via an install method that supports aliases
    And no prior binary named "ms" exists on PATH
    When the user runs "ms --version"
    Then the program prints "moodle-scraper <semver>" and exits with code 0

  Scenario: Alias skipped when name collision exists
    Given a binary named "ms" already exists on PATH
    When the program is installed
    Then the installer prints "Alias 'ms' skipped: name already exists on PATH."
    And "moodle-scraper" is still available on PATH
  ```
- **Rules**:
  - RULE-CLI-001-A: The primary binary name is exactly `moodle-scraper` (lowercase, hyphenated). No capitalisation variants are created.
  - RULE-CLI-001-B: The alias `ms` must point to the same executable code path, not a wrapper script that re-invokes `moodle-scraper`.
  - RULE-CLI-001-C: Both names report the same `--version` string.
- **Dependencies**: none

---

### REQ-CLI-002: `scrape` Command
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The `scrape` subcommand performs a scrape of the user's Moodle courses. It is also the default command: running `moodle-scraper` with no subcommand is identical to running `moodle-scraper scrape`. By default it performs an incremental scrape (only new or changed content is downloaded). The `--force` flag triggers a full re-sync. The `--dry-run` flag previews what would change without downloading or writing any files. The `--output <dir>` flag overrides the configured output directory for this invocation only. The `--courses <id1,id2,...>` flag restricts the scrape to the specified comma-separated Moodle course IDs. The `--concurrency <n>` flag controls the number of parallel download workers (integer 1–10, default 3).
- **Trigger**: User runs `moodle-scraper`, `moodle-scraper scrape`, or `ms scrape` with any combination of the flags described above.
- **Input**:
  - Optional flag `--force` (boolean, no value).
  - Optional flag `--dry-run` (boolean, no value).
  - Optional flag `--output <dir>` (string: absolute or relative filesystem path).
  - Optional flag `--courses <id1,id2,...>` (string: one or more positive integers separated by commas, no spaces).
  - Optional flag `--concurrency <n>` (integer: 1–10 inclusive).
  - Stored credentials (REQ-AUTH) and config (REQ-CLI-007).
- **Output / Outcome**:
  - Incremental (default): Only files that are new or whose remote checksum/timestamp differs from the local copy are downloaded and written to disk.
  - `--force`: All discoverable files are re-downloaded and overwritten regardless of local state.
  - `--dry-run`: A list of actions that *would* be taken is printed to stdout (one line per file: `[NEW|UPDATE|DELETE|SKIP] <relative-path>`). No files are written, deleted, or modified. Exits with code 0.
  - On completion (non-dry-run): prints a one-line summary: `Sync complete: <N> new, <M> updated, <K> deleted, <J> unchanged.`
- **Error Conditions**:
  - Credentials missing: exit code 2, message "No credentials found. Run: moodle-scraper auth set".
  - `--output <dir>` does not exist and cannot be created: exit code 4, message "Cannot create output directory: <dir> — <OS error>".
  - `--concurrency` value outside 1–10: exit code 1, message "--concurrency must be an integer between 1 and 10.".
  - `--courses` contains a non-integer token: exit code 1, message "--courses value '<token>' is not a valid course ID.".
  - `--courses` contains an ID not found on the user's enrolled course list: print warning "Course <id> not found in enrolled courses — skipped." and continue with remaining IDs.
  - `--force` and `--dry-run` used together: permitted; dry-run output shows all files as `[NEW|UPDATE]` (i.e., what a full re-sync would do).
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Default incremental scrape downloads only changed files
    Given valid credentials are stored
    And a previous sync has run and the local state is up to date
    And one file has changed on Moodle since the last sync
    When the user runs "moodle-scraper scrape"
    Then exactly one file is downloaded and written to disk
    And the summary line reads "Sync complete: 0 new, 1 updated, 0 deleted, <N> unchanged."
    And the exit code is 0

  Scenario: --force flag causes all files to be re-downloaded
    Given valid credentials are stored
    And a previous sync has run
    When the user runs "moodle-scraper scrape --force"
    Then all discoverable files are re-downloaded and overwritten
    And the exit code is 0

  Scenario: --dry-run prints planned actions without modifying disk
    Given valid credentials are stored
    And one new file exists on Moodle not present locally
    When the user runs "moodle-scraper scrape --dry-run"
    Then stdout contains a line starting with "[NEW]" for that file
    And no files are created or modified on disk
    And the exit code is 0

  Scenario: --courses limits scrape to specified IDs
    Given valid credentials are stored
    And the user is enrolled in courses 101 and 202
    When the user runs "moodle-scraper scrape --courses 101"
    Then only content from course 101 is downloaded
    And course 202 is not touched

  Scenario: Invalid --concurrency value
    Given the user runs "moodle-scraper scrape --concurrency 99"
    Then stdout contains "--concurrency must be an integer between 1 and 10."
    And the exit code is 1
  ```
- **Rules**:
  - RULE-CLI-002-A: Invoking `moodle-scraper` with no subcommand is strictly equivalent to `moodle-scraper scrape`; no deprecation warning is emitted.
  - RULE-CLI-002-B: Default concurrency is 3 unless overridden by `--concurrency` or the `concurrency` config key (REQ-CLI-007). Flag takes precedence over config.
  - RULE-CLI-002-C: `--output` overrides the output directory for the current invocation only; it does not persist to config.
  - RULE-CLI-002-D: In dry-run mode, zero bytes are written to or deleted from disk. Temporary files are not created.
  - RULE-CLI-002-E: The summary line is always printed to stdout on success, even in `--quiet` mode (REQ-CLI-009).
- **Dependencies**: REQ-AUTH-001, REQ-SCRAPE-001, REQ-SYNC-001, REQ-FS-001, REQ-CLI-007, REQ-CLI-009, REQ-CLI-010

---

### REQ-CLI-003: `auth set` Subcommand
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The `auth set` subcommand interactively collects the Moodle base URL (if not already configured), the user's Moodle username (displayed as typed), and the user's Moodle password (input hidden via a password prompt). It immediately attempts a login to verify the credentials. On success it stores them securely in the OS Keychain and prints a confirmation. On failure it prints a specific error and stores nothing.
- **Trigger**: User runs `moodle-scraper auth set`.
- **Input**:
  - Moodle base URL: prompted only if not present in config (`moodleUrl` key). Accepts `https://` URLs only.
  - Username: prompted interactively, displayed as typed (not hidden).
  - Password: prompted interactively, input hidden (no echo).
- **Output / Outcome**:
  - On successful login: credentials written to OS Keychain under the service name `moodle-scraper`; stdout prints exactly `Credentials saved.`
  - On login failure: nothing written to Keychain; specific error printed (see Error Conditions); exits with code 2.
- **Error Conditions**:
  - Invalid Moodle URL (not `https://`, malformed, or returns non-200 on a HEAD request to the root): print "Invalid Moodle URL: <url> — <reason>." and re-prompt (up to 3 attempts), then exit with code 1 if all attempts fail.
  - Empty username submitted: print "Username cannot be empty." and re-prompt.
  - Empty password submitted: print "Password cannot be empty." and re-prompt.
  - Login attempt returns HTTP 4xx (wrong credentials): print "Login failed: incorrect username or password." and exit with code 2; do not retry automatically.
  - Login attempt returns HTTP 5xx or network error: print "Login failed: Moodle server error (<status>). Try again later." and exit with code 3.
  - Keychain write fails: print "Failed to save credentials to Keychain: <OS error>." and exit with code 1.
  - `--non-interactive` flag is active (REQ-CLI-010): exit with code 2, message "No credentials found. Run: moodle-scraper auth set".
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Successful credential entry and verification
    Given the user runs "moodle-scraper auth set"
    And the Moodle URL is already in config
    When the user enters a valid username and password
    And the login attempt succeeds
    Then stdout prints exactly "Credentials saved."
    And the credentials are stored in the OS Keychain
    And the exit code is 0

  Scenario: Wrong password
    Given the user runs "moodle-scraper auth set"
    When the user enters an incorrect password
    And the Moodle server returns HTTP 403
    Then stdout prints "Login failed: incorrect username or password."
    And nothing is written to the Keychain
    And the exit code is 2

  Scenario: Empty username rejected
    Given the user runs "moodle-scraper auth set"
    When the user submits an empty username
    Then stdout prints "Username cannot be empty."
    And the prompt is shown again

  Scenario: Non-interactive mode blocks auth set
    Given the "--non-interactive" flag is active
    When the user runs "moodle-scraper auth set"
    Then stdout prints "No credentials found. Run: moodle-scraper auth set"
    And the exit code is 2
  ```
- **Rules**:
  - RULE-CLI-003-A: The password value is never written to stdout, stderr, log files, or shell history by the program.
  - RULE-CLI-003-B: The URL prompt is skipped entirely if `moodleUrl` is already present in config.
  - RULE-CLI-003-C: The login verification request must use HTTPS exclusively (REQ-SEC).
  - RULE-CLI-003-D: On failure, any partially constructed session data (cookies, tokens) is discarded before exit.
  - RULE-CLI-003-E: The Keychain service name is the fixed string `moodle-scraper`; the account name is the username.
- **Dependencies**: REQ-AUTH-001, REQ-SEC-001, REQ-CLI-007, REQ-CLI-010

---

### REQ-CLI-004: `auth clear` Subcommand
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The `auth clear` subcommand removes the stored Moodle credentials from the OS Keychain and deletes the local session file (cookies/tokens cache). If credentials exist it prints a confirmation including the session file path. If nothing was stored it prints a distinct "nothing to clear" message. The command never prompts for confirmation; it acts immediately.
- **Trigger**: User runs `moodle-scraper auth clear`.
- **Input**: None (no flags or arguments).
- **Output / Outcome**:
  - Credentials were present and are now removed, and session file existed and is now deleted: stdout prints exactly `Removed: credentials from Keychain, session file at <absolute-path>.`
  - Credentials were present but no session file existed: stdout prints `Removed: credentials from Keychain. No session file found.`
  - No credentials and no session file: stdout prints exactly `Nothing to clear.`
  - Exit code 0 in all above cases.
- **Error Conditions**:
  - Keychain delete fails (OS error): print "Failed to remove credentials from Keychain: <OS error>." and exit with code 1.
  - Session file exists but cannot be deleted (permission error): print "Failed to delete session file at <path>: <OS error>." and exit with code 4.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Credentials and session file both present
    Given credentials are stored in the Keychain
    And a session file exists at the default path
    When the user runs "moodle-scraper auth clear"
    Then the Keychain entry is deleted
    And the session file is deleted
    And stdout prints "Removed: credentials from Keychain, session file at <path>."
    And the exit code is 0

  Scenario: Nothing was stored
    Given no credentials exist in the Keychain
    And no session file exists
    When the user runs "moodle-scraper auth clear"
    Then stdout prints "Nothing to clear."
    And the exit code is 0

  Scenario: Keychain deletion fails
    Given credentials are stored in the Keychain
    And the OS Keychain returns an error on deletion
    When the user runs "moodle-scraper auth clear"
    Then stdout prints "Failed to remove credentials from Keychain: <OS error>."
    And the exit code is 1
  ```
- **Rules**:
  - RULE-CLI-004-A: The `<absolute-path>` in the confirmation message is the resolved absolute path of the session file, not a relative or `~`-prefixed path.
  - RULE-CLI-004-B: No confirmation prompt is shown. The command is destructive-immediate by design.
  - RULE-CLI-004-C: The session file path is determined by config or the fixed default; it is never taken from user input at runtime.
- **Dependencies**: REQ-AUTH-001, REQ-AUTH-002, REQ-CLI-007

---

### REQ-CLI-005: `auth status` Subcommand
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The `auth status` subcommand prints the current state of stored credentials and the local session. It always prints exactly two lines. The first line reports whether credentials are present in the Keychain. The second line reports the state of the local session token/cookie file. The password, session token, and cookie values are never printed under any circumstances.
- **Trigger**: User runs `moodle-scraper auth status`.
- **Input**: None (no flags or arguments).
- **Output / Outcome**:
  - Line 1: `Credentials: stored` if credentials exist in the Keychain, or `Credentials: not stored` if they do not.
  - Line 2: `Session: valid` if the session file exists and the token/cookie within it has not expired; `Session: expired` if the file exists but the token/cookie is past its expiry timestamp; `Session: unknown` if no session file exists or the file cannot be parsed.
  - Exit code 0 in all cases where the command itself ran without error.
- **Error Conditions**:
  - Keychain read fails with an OS error (not "not found"): print "Credentials: error (<OS error>)" on line 1 and exit with code 1.
  - Session file exists but is not valid JSON or is unreadable: line 2 reads `Session: unknown` (not an error exit).
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Credentials stored and session valid
    Given credentials exist in the Keychain
    And a session file exists with a non-expired token
    When the user runs "moodle-scraper auth status"
    Then stdout line 1 is "Credentials: stored"
    And stdout line 2 is "Session: valid"
    And the exit code is 0

  Scenario: Credentials stored and session expired
    Given credentials exist in the Keychain
    And a session file exists with an expired token
    When the user runs "moodle-scraper auth status"
    Then stdout line 1 is "Credentials: stored"
    And stdout line 2 is "Session: expired"

  Scenario: Nothing stored
    Given no credentials exist in the Keychain
    And no session file exists
    When the user runs "moodle-scraper auth status"
    Then stdout line 1 is "Credentials: not stored"
    And stdout line 2 is "Session: unknown"
    And the exit code is 0

  Scenario: Password is never revealed
    Given credentials exist in the Keychain
    When the user runs "moodle-scraper auth status"
    Then stdout does not contain the password value
    And stdout does not contain any session token or cookie value
  ```
- **Rules**:
  - RULE-CLI-005-A: Output is exactly two lines. No trailing blank lines, no headers, no decorations.
  - RULE-CLI-005-B: The words `stored`, `not stored`, `valid`, `expired`, and `unknown` are the only allowed values for the status fields; casing is lowercase as shown.
  - RULE-CLI-005-C: The password, session token, and cookie values must not appear in stdout, stderr, or log output at any log level.
  - RULE-CLI-005-D: "Session: valid" requires that the expiry timestamp embedded in the session file is in the future at the time the command runs.
- **Dependencies**: REQ-AUTH-001, REQ-AUTH-002

---

### REQ-CLI-006: `status` Command
- **Type**: Functional
- **Priority**: Should-Have
- **Description**: The `status` command prints a human-readable summary table of the scraper's current sync state. It performs a lightweight check against the Moodle server to determine how many files would change on the next incremental sync, without downloading any content. The table always contains exactly five rows.
- **Trigger**: User runs `moodle-scraper status`.
- **Input**: Stored credentials and session (REQ-AUTH). No additional flags required (global flags `--verbose`, `--quiet`, `--non-interactive` apply).
- **Output / Outcome**: Stdout prints a table with the following rows (label: value format, labels left-padded to align colons):
  ```
  Tracked courses  : <N>
  Tracked files    : <N>
  Last sync        : <ISO8601 datetime> | never
  Orphaned items   : <N>
  Pending changes  : <N>
  ```
  Exit code 0.
- **Error Conditions**:
  - Credentials missing: exit code 2, message "No credentials found. Run: moodle-scraper auth set".
  - Network unreachable (cannot contact Moodle for pending-changes check): print the table with `Pending changes  : unknown` and exit with code 3.
  - Local state database missing or unreadable: print "Local state database not found. Run: moodle-scraper scrape" and exit with code 1.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Normal status after a completed sync
    Given valid credentials are stored
    And at least one previous sync has completed
    And the Moodle server is reachable
    When the user runs "moodle-scraper status"
    Then stdout contains exactly five labelled rows
    And the "Last sync" value is a valid ISO8601 datetime string
    And "Pending changes" shows the count of files that would be updated
    And the exit code is 0

  Scenario: Network unavailable during status check
    Given valid credentials are stored
    And the Moodle server is unreachable
    When the user runs "moodle-scraper status"
    Then the table is printed with "Pending changes  : unknown"
    And the exit code is 3

  Scenario: No sync has ever run
    Given no local state database exists
    When the user runs "moodle-scraper status"
    Then stdout prints "Local state database not found. Run: moodle-scraper scrape"
    And the exit code is 1
  ```
- **Rules**:
  - RULE-CLI-006-A: The lightweight Moodle check for pending changes must not download any file content; it only fetches metadata (e.g., file modification timestamps or checksums from Moodle's API).
  - RULE-CLI-006-B: "Orphaned items" are local files tracked in the state database that no longer appear in the user's Moodle courses.
  - RULE-CLI-006-C: "Last sync" is `never` (literal string) if no sync has completed; otherwise it is the ISO8601 datetime of the most recent completed sync in UTC (e.g., `2025-09-01T14:32:00Z`).
  - RULE-CLI-006-D: The table column widths are fixed so that all colons align vertically.
- **Dependencies**: REQ-AUTH-001, REQ-SCRAPE-001, REQ-SYNC-001, REQ-CLI-010

---

### REQ-CLI-007: `config` Command
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The `config` command provides three subcommands — `config set <key> <value>`, `config get <key>`, and `config list` — for reading and writing the program's persistent configuration file. The config file is stored at `~/.config/moodle-scraper/config.json`. The command validates key names and value types strictly; unknown keys and invalid values are rejected with a descriptive error message.
- **Trigger**: User runs `moodle-scraper config set <key> <value>`, `moodle-scraper config get <key>`, or `moodle-scraper config list`.
- **Input**:
  - Subcommand `set`: positional arguments `<key>` (string) and `<value>` (string, parsed to the key's type).
  - Subcommand `get`: positional argument `<key>` (string).
  - Subcommand `list`: no arguments.
  - Valid keys and their types/constraints:
    | Key | Type | Constraints |
    |---|---|---|
    | `moodleUrl` | string | Must start with `https://`, must be a valid URL |
    | `outputDir` | string | Must be an absolute path |
    | `concurrency` | integer | 1–10 inclusive |
    | `requestDelayMs` | integer | 100–5000 inclusive |
    | `logFile` | string | Must be an absolute path or empty string |
    | `metadata` | boolean | `true` or `false` |
- **Output / Outcome**:
  - `config set`: writes the key-value pair to `~/.config/moodle-scraper/config.json` (creating the file and directory if absent); prints `Set <key> = <value>.` and exits with code 0.
  - `config get`: prints `<key> = <value>` if the key is set; prints `<key> is not set.` if the key is absent from the file; exits with code 0.
  - `config list`: prints all currently set keys in `<key> = <value>` format, one per line, sorted alphabetically. If no keys are set, prints `No configuration set.` Exits with code 0.
- **Error Conditions**:
  - Unknown key name in `set` or `get`: print "Unknown config key: '<key>'. Valid keys: moodleUrl, outputDir, concurrency, requestDelayMs, logFile, metadata." and exit with code 1.
  - Value fails type or constraint validation in `set`: print "Invalid value for <key>: <reason>." and exit with code 1.
  - Config file exists but is not valid JSON: print "Config file is corrupted: <path>. Delete it and reconfigure." and exit with code 1.
  - Config directory cannot be created (permission error): print "Cannot create config directory: <path> — <OS error>." and exit with code 4.
  - `config set` called with missing `<value>` argument: print "Usage: moodle-scraper config set <key> <value>" and exit with code 1.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Set a valid config key
    Given no config file exists
    When the user runs "moodle-scraper config set concurrency 5"
    Then the file ~/.config/moodle-scraper/config.json is created
    And it contains {"concurrency": 5}
    And stdout prints "Set concurrency = 5."
    And the exit code is 0

  Scenario: Get a key that is set
    Given the config file contains {"concurrency": 5}
    When the user runs "moodle-scraper config get concurrency"
    Then stdout prints "concurrency = 5"
    And the exit code is 0

  Scenario: Get a key that is not set
    Given the config file exists but does not contain "outputDir"
    When the user runs "moodle-scraper config get outputDir"
    Then stdout prints "outputDir is not set."
    And the exit code is 0

  Scenario: List all config keys
    Given the config file contains {"concurrency": 3, "moodleUrl": "https://moodle.example.com"}
    When the user runs "moodle-scraper config list"
    Then stdout prints two lines in alphabetical order: "concurrency = 3" then "moodleUrl = https://moodle.example.com"
    And the exit code is 0

  Scenario: Unknown key rejected
    Given any config state
    When the user runs "moodle-scraper config set unknownKey value"
    Then stdout prints a message containing "Unknown config key: 'unknownKey'."
    And the exit code is 1

  Scenario: Out-of-range integer rejected
    Given any config state
    When the user runs "moodle-scraper config set concurrency 11"
    Then stdout prints "Invalid value for concurrency: must be an integer between 1 and 10."
    And the exit code is 1
  ```
- **Rules**:
  - RULE-CLI-007-A: The config file path is always `~/.config/moodle-scraper/config.json`; it is not configurable.
  - RULE-CLI-007-B: The config file is valid JSON at all times. Writes are atomic: the new content is written to a temp file and then renamed over the existing file to prevent corruption.
  - RULE-CLI-007-C: `moodleUrl` must start with `https://`. HTTP URLs are rejected with the reason "moodleUrl must use HTTPS."
  - RULE-CLI-007-D: `outputDir` and `logFile` must be absolute paths when non-empty. Relative paths are rejected with the reason "must be an absolute path."
  - RULE-CLI-007-E: Boolean values for `metadata` accept only the strings `true` and `false` (case-sensitive) as input to `config set`.
- **Dependencies**: none

---

### REQ-CLI-008: `--verbose` / `-v` Flag
- **Type**: Non-Functional
- **Priority**: Should-Have
- **Description**: The `--verbose` (long form) or `-v` (short form) flag is available on every command and subcommand. When active it prints detailed per-request and per-file diagnostic information to stdout in addition to normal output. This flag raises the effective log level to DEBUG if `--log` is also active.
- **Trigger**: User appends `--verbose` or `-v` to any command invocation.
- **Input**: Boolean flag (no value). Can appear anywhere in the argument list.
- **Output / Outcome**:
  - For each outgoing HTTP request: one line in the format `[HTTP] <METHOD> <URL> → <status-code> (<duration>ms)`.
  - For each file evaluated during a scrape or dry-run: one line in the format `[FILE] <relative-path>: <decision> — <reason>`, where `<decision>` is one of `new`, `unchanged`, `updated`, `skipped` and `<reason>` is a human-readable string (e.g., "remote checksum differs", "file not in scope").
  - Normal command output is still printed.
- **Error Conditions**:
  - `--verbose` and `--quiet` used together: print "Flags --verbose and --quiet are mutually exclusive." and exit with code 1 (see REQ-CLI-009).
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Verbose output during scrape
    Given valid credentials are stored
    And "--verbose" flag is passed
    When the user runs "moodle-scraper scrape --verbose"
    Then stdout contains at least one "[HTTP]" line per HTTP request made
    And stdout contains at least one "[FILE]" line per file evaluated
    And the final summary line is still printed
    And the exit code is 0

  Scenario: -v short form is equivalent
    Given valid credentials are stored
    When the user runs "moodle-scraper scrape -v"
    Then the output is identical to running with "--verbose"

  Scenario: --verbose and --quiet are mutually exclusive
    When the user runs "moodle-scraper scrape --verbose --quiet"
    Then stdout prints "Flags --verbose and --quiet are mutually exclusive."
    And the exit code is 1
  ```
- **Rules**:
  - RULE-CLI-008-A: `[HTTP]` lines must include all four fields: method, full URL, response status code, and duration in milliseconds. Credentials or tokens must not appear in the URL or any verbose output; they are replaced with `[REDACTED]`.
  - RULE-CLI-008-B: `[FILE]` decision values are limited to exactly: `new`, `unchanged`, `updated`, `skipped`. No other values are used.
  - RULE-CLI-008-C: Verbose output is written to stdout (not stderr) so it can be piped and captured.
  - RULE-CLI-008-D: When `--log` is also active, `--verbose` raises the log file level from INFO to DEBUG.
- **Dependencies**: REQ-CLI-009, REQ-CLI-012

---

### REQ-CLI-009: `--quiet` / `-q` Flag
- **Type**: Non-Functional
- **Priority**: Should-Have
- **Description**: The `--quiet` (long form) or `-q` (short form) flag suppresses all stdout output except error messages and the final one-line summary produced by each command. It is mutually exclusive with `--verbose` / `-v`; if both are provided the program exits immediately with code 1 and a descriptive error.
- **Trigger**: User appends `--quiet` or `-q` to any command invocation.
- **Input**: Boolean flag (no value). Can appear anywhere in the argument list.
- **Output / Outcome**:
  - All informational and progress output is suppressed.
  - Error messages (those that precede a non-zero exit) are still printed to stdout.
  - The final one-line summary (e.g., `Sync complete: ...`) is still printed to stdout.
  - Exit code behaviour is unchanged.
- **Error Conditions**:
  - `--quiet` and `--verbose` used together: print "Flags --verbose and --quiet are mutually exclusive." and exit with code 1.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Quiet mode suppresses progress output
    Given valid credentials are stored
    And "--quiet" flag is passed
    When the user runs "moodle-scraper scrape --quiet"
    Then stdout contains only the final summary line
    And no per-file or per-request lines are printed
    And the exit code is 0

  Scenario: -q short form is equivalent
    When the user runs "moodle-scraper scrape -q"
    Then the output is identical to running with "--quiet"

  Scenario: Error message still printed in quiet mode
    Given "--quiet" flag is active
    And credentials are missing
    When the user runs "moodle-scraper scrape --quiet"
    Then stdout prints "No credentials found. Run: moodle-scraper auth set"
    And the exit code is 2

  Scenario: Mutual exclusion with --verbose
    When the user runs "moodle-scraper scrape --quiet --verbose"
    Then stdout prints "Flags --verbose and --quiet are mutually exclusive."
    And the exit code is 1
  ```
- **Rules**:
  - RULE-CLI-009-A: In quiet mode, the only stdout lines are: (a) the final one-line summary, and (b) any error message that accompanies a non-zero exit. All other output is suppressed.
  - RULE-CLI-009-B: Quiet mode does not affect log file output (REQ-CLI-012). The log file, if active, receives full output.
  - RULE-CLI-009-C: The mutual-exclusion check is performed before any other processing so that no side effects (network, disk) occur before the error exits.
- **Dependencies**: REQ-CLI-008, REQ-CLI-012

---

### REQ-CLI-010: `--non-interactive` Flag
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The `--non-interactive` flag prevents the program from issuing any interactive prompt to the user. It is intended for scripted and CI/CD use. When active, any situation that would normally prompt the user instead causes an immediate exit with a deterministic exit code and message. It is available on all commands.
- **Trigger**: User (or a script) appends `--non-interactive` to any command invocation.
- **Input**: Boolean flag (no value).
- **Output / Outcome**: The program runs to completion without pausing for input. If it encounters a situation requiring input, it exits immediately with the appropriate exit code and message (see Error Conditions).
- **Error Conditions**:
  - Credentials are missing and would normally trigger a prompt: exit with code 2, message "No credentials found. Run: moodle-scraper auth set".
  - `auth set` is invoked with `--non-interactive`: exit with code 2, message "No credentials found. Run: moodle-scraper auth set".
  - A disk-space warning would normally prompt for confirmation: treat as abort; exit with code 4, message "Insufficient disk space: <available>MB available, <required>MB required. Aborting.".
  - Any other interactive prompt is triggered: exit with code 1, message "Interactive prompt required but --non-interactive flag is set: <prompt description>.".
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Scrape runs without prompts when credentials exist
    Given valid credentials are stored
    And "--non-interactive" flag is active
    When the user runs "moodle-scraper scrape --non-interactive"
    Then the scrape completes without any prompts
    And the exit code is 0

  Scenario: Missing credentials cause immediate exit in non-interactive mode
    Given no credentials are stored
    And "--non-interactive" flag is active
    When the user runs "moodle-scraper scrape --non-interactive"
    Then stdout prints "No credentials found. Run: moodle-scraper auth set"
    And the exit code is 2
    And no network requests are made

  Scenario: auth set exits immediately in non-interactive mode
    Given "--non-interactive" flag is active
    When the user runs "moodle-scraper auth set --non-interactive"
    Then stdout prints "No credentials found. Run: moodle-scraper auth set"
    And the exit code is 2

  Scenario: Disk space warning treated as abort in non-interactive mode
    Given "--non-interactive" flag is active
    And available disk space is less than required
    When the user runs "moodle-scraper scrape --non-interactive"
    Then stdout prints "Insufficient disk space: <N>MB available, <M>MB required. Aborting."
    And the exit code is 4
  ```
- **Rules**:
  - RULE-CLI-010-A: In non-interactive mode, zero blocking stdin reads are performed. The program must not call any API that reads from stdin.
  - RULE-CLI-010-B: The `--non-interactive` check is performed before any network or disk operations so that no side effects occur before the error exits.
  - RULE-CLI-010-C: `--non-interactive` is compatible with all other flags. It does not override `--verbose` or `--quiet`.
- **Dependencies**: REQ-CLI-003, REQ-CLI-009

---

### REQ-CLI-011: Exit Codes
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The program uses a fixed, documented set of exit codes. Every execution path terminates with exactly one of the five defined exit codes. These codes must be stable across versions so that scripts and CI pipelines can depend on them.
- **Trigger**: Any program execution that terminates (normally or due to error).
- **Input**: N/A — exit codes are outputs, not inputs.
- **Output / Outcome**: The process exits with the integer exit code corresponding to the outcome category:
  - `0` — completed successfully, including dry-run completions and "nothing to do" cases.
  - `1` — general or unhandled error (bad flag value, corrupted state file, unexpected exception).
  - `2` — authentication failure or missing credentials.
  - `3` — network error (Moodle server unreachable, DNS failure, TLS error, request timeout).
  - `4` — filesystem error (disk full, permission denied on output directory or session file).
- **Error Conditions**:
  - An unhandled exception or panic occurs: exit with code 1. The exception message is printed to stdout; the stack trace is written to the log file (if active) but not to stdout.
  - Multiple error categories occur in the same run (e.g., network error followed by filesystem error): the first encountered error determines the exit code.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Successful scrape exits 0
    Given valid credentials are stored
    And the Moodle server is reachable
    When the user runs "moodle-scraper scrape"
    Then the exit code is 0

  Scenario: Missing credentials exits 2
    Given no credentials are stored
    When the user runs "moodle-scraper scrape"
    Then the exit code is 2

  Scenario: Moodle server unreachable exits 3
    Given valid credentials are stored
    And the Moodle server is not reachable
    When the user runs "moodle-scraper scrape"
    Then the exit code is 3

  Scenario: Disk full exits 4
    Given valid credentials are stored
    And the target filesystem has no free space
    When the user runs "moodle-scraper scrape"
    Then the exit code is 4

  Scenario: Dry-run exits 0
    Given valid credentials are stored
    When the user runs "moodle-scraper scrape --dry-run"
    Then the exit code is 0
  ```
- **Rules**:
  - RULE-CLI-011-A: Exit codes 0–4 are the complete and exclusive set. No other exit codes are used by the program.
  - RULE-CLI-011-B: Exit code semantics must be documented in `--help` output for every command.
  - RULE-CLI-011-C: The exit code is set immediately before process termination; no cleanup step may alter it after it has been determined.
  - RULE-CLI-011-D: A dry-run that detects pending changes (i.e., files that would be modified) still exits with code 0.
- **Dependencies**: none

---

### REQ-CLI-012: Log File Output
- **Type**: Non-Functional
- **Priority**: Should-Have
- **Description**: The `--log <path>` flag (available on all commands) writes a full, timestamped log of the program's execution to the specified file path. All log entries that would contain credentials, session tokens, or cookie values instead have those values replaced with the literal string `[REDACTED]`. The default log level is INFO; the `--verbose` flag raises it to DEBUG. The log file is in addition to (not instead of) stdout output.
- **Trigger**: User appends `--log <path>` to any command invocation.
- **Input**: `--log <path>` where `<path>` is a writable absolute or relative file path. If the file does not exist it is created; if it exists, new entries are appended.
- **Output / Outcome**: A log file at `<path>` containing one entry per line in the format:
  ```
  <ISO8601-datetime> [<LEVEL>] <message>
  ```
  where `<LEVEL>` is one of `DEBUG`, `INFO`, `WARN`, `ERROR`. All credential, token, and cookie values are `[REDACTED]`.
- **Error Conditions**:
  - `<path>` is a directory: print "Cannot write log to a directory: <path>." and exit with code 1.
  - `<path>` is not writable (permission denied): print "Cannot open log file for writing: <path> — Permission denied." and exit with code 4.
  - Parent directory of `<path>` does not exist: print "Cannot open log file: parent directory does not exist: <parent-path>." and exit with code 1.
  - Disk becomes full mid-run while writing to the log: print a WARN entry to stdout "Log write failed: disk full. Continuing without log." and continue execution (log file may be incomplete).
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Log file created and populated
    Given the user runs "moodle-scraper scrape --log /tmp/test.log"
    When the scrape completes
    Then the file /tmp/test.log exists
    And each line matches the format "<ISO8601> [LEVEL] <message>"
    And the file contains at least one INFO entry
    And the exit code is 0

  Scenario: --verbose raises log level to DEBUG
    Given the user runs "moodle-scraper scrape --verbose --log /tmp/test.log"
    When the scrape completes
    Then /tmp/test.log contains at least one DEBUG entry

  Scenario: Credentials are redacted in log file
    Given credentials are in use
    And the user runs "moodle-scraper scrape --log /tmp/test.log"
    When the scrape completes
    Then no line in /tmp/test.log contains the password value
    And no line contains any raw session token or cookie value
    And lines that would contain those values show "[REDACTED]" instead

  Scenario: Log file appended on subsequent runs
    Given /tmp/test.log already exists with prior content
    When the user runs "moodle-scraper scrape --log /tmp/test.log" again
    Then the new entries are appended after the existing content
  ```
- **Rules**:
  - RULE-CLI-012-A: Redaction is applied before any string is written to the log file. It is not applied post-hoc.
  - RULE-CLI-012-B: The redaction pattern covers: the stored password, any session token, and all cookie values. Cookie names (keys) are not redacted, only their values.
  - RULE-CLI-012-C: Log file writes do not block or slow down the main execution path by more than 5ms p99 per log entry.
  - RULE-CLI-012-D: The log file is always appended to, never truncated, so that multiple consecutive runs accumulate history.
  - RULE-CLI-012-E: The `--log` path may also be set via the `logFile` config key (REQ-CLI-007). The flag takes precedence over the config value.
- **Dependencies**: REQ-CLI-007, REQ-CLI-008, REQ-SEC-001

---

### REQ-CLI-013: Help Text
- **Type**: UX
- **Priority**: Must-Have
- **Description**: Every command and subcommand (including `auth set`, `auth clear`, `auth status`, `config set`, `config get`, `config list`) supports a `--help` flag that prints structured help text and exits with code 0. The help text is complete, accurate, and self-contained: a user should be able to operate the tool using only the help text.
- **Trigger**: User appends `--help` (or `-h` as a short form) to any command or subcommand, or runs `moodle-scraper` with no arguments and no default subcommand context.
- **Input**: `--help` or `-h` boolean flag.
- **Output / Outcome**: Stdout prints, in order:
  1. A usage line: `Usage: moodle-scraper <command> [flags]` (or the subcommand-specific variant).
  2. A one-sentence description of what the command does.
  3. A flags section listing every flag with: flag name(s), value type (if applicable), default value (if applicable), and a one-line description.
  4. An exit codes section listing all applicable exit codes and their meanings.
  5. One example invocation with a brief inline comment.
  Exit code is 0.
- **Error Conditions**:
  - `--help` combined with other flags or arguments: `--help` takes precedence; all other flags and arguments are ignored; help is printed and the program exits with code 0.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: --help on the root command
    When the user runs "moodle-scraper --help"
    Then stdout contains a usage line
    And stdout lists all top-level subcommands with descriptions
    And stdout exits with code 0

  Scenario: --help on a subcommand
    When the user runs "moodle-scraper auth set --help"
    Then stdout contains the usage line for "auth set"
    And stdout lists all flags for "auth set" with types and defaults
    And stdout contains at least one example invocation
    And the exit code is 0

  Scenario: --help takes precedence over other flags
    When the user runs "moodle-scraper scrape --force --help"
    Then help text is printed
    And no scrape is initiated
    And the exit code is 0

  Scenario: -h short form works identically
    When the user runs "moodle-scraper scrape -h"
    Then the output is identical to "moodle-scraper scrape --help"
  ```
- **Rules**:
  - RULE-CLI-013-A: The flags section must list every flag accepted by the command with no omissions.
  - RULE-CLI-013-B: Default values are shown in brackets, e.g., `--concurrency <n>  Number of parallel downloads [default: 3]`.
  - RULE-CLI-013-C: The exit codes section must be present in the help text for every command that can produce a non-zero exit code.
  - RULE-CLI-013-D: `-h` is accepted as a synonym for `--help` on all commands and subcommands.
  - RULE-CLI-013-E: Help text is written to stdout (not stderr).
- **Dependencies**: REQ-CLI-011

---

### REQ-CLI-014: Version Flag
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: The `--version` flag prints the program's current semantic version string and exits. The output format is fixed and machine-parseable. The flag is available at the root level (i.e., `moodle-scraper --version`) and must not be passed through to subcommands.
- **Trigger**: User runs `moodle-scraper --version` or `ms --version`.
- **Input**: `--version` boolean flag at root level.
- **Output / Outcome**: Stdout prints exactly one line: `moodle-scraper <semver>` where `<semver>` is the program's version in Semantic Versioning 2.0.0 format (e.g., `moodle-scraper 1.2.3`). No trailing newline beyond the standard line ending. Exit code 0.
- **Error Conditions**:
  - `--version` combined with any other flag or subcommand: `--version` takes precedence; the version line is printed and the program exits with code 0. No other processing occurs.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: --version prints correct format
    When the user runs "moodle-scraper --version"
    Then stdout contains exactly one line matching "moodle-scraper \d+\.\d+\.\d+"
    And the exit code is 0

  Scenario: --version takes precedence over subcommands
    When the user runs "moodle-scraper scrape --version"
    Then stdout prints the version line
    And no scrape is initiated
    And the exit code is 0

  Scenario: --version via alias
    Given the "ms" alias is registered
    When the user runs "ms --version"
    Then stdout prints "moodle-scraper <semver>" (not "ms <semver>")
    And the exit code is 0
  ```
- **Rules**:
  - RULE-CLI-014-A: The version string must match Semantic Versioning 2.0.0 format: `MAJOR.MINOR.PATCH` with optional pre-release suffix (e.g., `1.0.0-beta.1`).
  - RULE-CLI-014-B: The output is always `moodle-scraper <semver>`, regardless of whether the user invoked the program via the alias `ms` or the full name.
  - RULE-CLI-014-C: The version value is baked into the binary at build time and is not read from the config file or any runtime source.
  - RULE-CLI-014-D: Only one line is printed. No extra headers, decorations, or newlines.
- **Dependencies**: REQ-CLI-001

---

## Security

### REQ-SEC-001: Credential Storage Exclusivity
- **Type**: Security
- **Priority**: Must-Have
- **Description**: Passwords and session tokens are stored exclusively in the macOS Keychain via the system Keychain API. No config file, `.env` file, environment variable, or any plaintext file may contain a password or token at any point in the application lifecycle — including initial configuration, runtime, or error recovery. Any code path that writes a credential to any medium other than the Keychain is a defect.
- **Trigger**: Any operation that creates, updates, or reads authentication credentials (initial setup, login, token refresh, or logout).
- **Input**: A plaintext password or session token string provided by the user or derived from a login response.
- **Output / Outcome**: The credential is written to the macOS Keychain under a well-defined service name (`moodle-scraper`) and account key (`moodle-password` or `moodle-session-token`). No other persistence medium holds the value. The credential is readable back from the Keychain on the same machine by the same user.
- **Error Conditions**:
  - Keychain write fails (e.g., user denies access): abort with `"Error: Could not store credential in Keychain: <reason>."` — do not fall back to any other storage mechanism.
  - Keychain read fails at runtime: abort with `"Error: Could not retrieve credential from Keychain: <reason>."` — do not prompt for inline input or cache the value in memory longer than the current operation requires.
  - A credential value is detected in a config file or environment variable during startup: abort with `"Error: Credential detected outside Keychain in <location> — refusing to continue."`.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Password is stored only in the Keychain after initial setup
    Given the user runs the initial setup command with their Moodle password
    When setup completes successfully
    Then the password is present in the macOS Keychain under service "moodle-scraper"
    And no config file, .env file, or environment variable contains the password

  Scenario: Application refuses to start when a credential is found outside the Keychain
    Given a config file contains a field named "password" with a non-empty value
    When the application starts
    Then it exits with a non-zero exit code
    And prints "Error: Credential detected outside Keychain in <location> — refusing to continue."
    And does not proceed to authenticate

  Scenario: Keychain write failure is handled without fallback
    Given the macOS Keychain denies the write operation
    When the user attempts initial setup
    Then the application exits with a non-zero exit code
    And prints "Error: Could not store credential in Keychain: <reason>."
    And no credential is written to any file or environment
  ```
- **Rules**:
  - RULE-SEC-001-A: The Keychain service name is the fixed string `moodle-scraper`; the account key for the password is `moodle-password`; the account key for the session token is `moodle-session-token`.
  - RULE-SEC-001-B: In-memory credential lifetime is scoped to the smallest possible function call; the value must not be stored in a module-level variable or passed as a plain string beyond the function that requires it.
  - RULE-SEC-001-C: There is no `--password` or `--token` CLI flag; credentials are never accepted as CLI arguments.
- **Dependencies**: REQ-AUTH-001 (authentication flow must use Keychain-retrieved credentials)

---

### REQ-SEC-002: Log and Output Redaction
- **Type**: Security
- **Priority**: Must-Have
- **Description**: Before any string is written to stdout, stderr, or a log file, the logging layer scans the string for known-sensitive values — specifically the current plaintext password retrieved from the Keychain, the current session token value, and the full value of any `Cookie` request header — and replaces each sensitive substring with the literal token `[REDACTED]`. This scan-and-replace is applied unconditionally, including when `--verbose` mode is active. The redaction function is applied as the final step before I/O write, so that no code path can bypass it by writing directly to the output stream.
- **Trigger**: Any write to stdout, stderr, or a log file — including informational messages, debug output, request/response traces in `--verbose` mode, and error messages.
- **Input**: A string intended for output; the current in-memory set of known-sensitive values (password, session token, Cookie header value).
- **Output / Outcome**: The string is written to the output destination with all occurrences of each sensitive value replaced by `[REDACTED]`. The length and structure of surrounding non-sensitive text is preserved unchanged.
- **Error Conditions**:
  - Sensitive value set is empty or uninitialised at the time of a write: treat all writes as safe to emit (no known values to redact) but log a debug-level notice `"Redaction set empty — no values to redact."` at the start of each session.
  - Redaction function itself throws: catch the exception, emit `"[LOG ERROR: redaction failed — output suppressed]"` in place of the original line, and do not rethrow.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Session token is redacted from verbose HTTP trace output
    Given the application holds a valid session token "abc123secret"
    And --verbose mode is active
    When an HTTP request is logged that includes the header "Cookie: MoodleSession=abc123secret"
    Then the logged line reads "Cookie: MoodleSession=[REDACTED]"
    And the string "abc123secret" does not appear anywhere in stdout, stderr, or the log file

  Scenario: Password is redacted from an error message that echoes user input
    Given the application holds the password "hunter2" retrieved from the Keychain
    When an error message is constructed that inadvertently includes "hunter2"
    Then the emitted error message contains "[REDACTED]" in place of "hunter2"
    And the string "hunter2" does not appear in stdout, stderr, or the log file

  Scenario: Non-sensitive output passes through unmodified
    Given a log message "Downloading file: lecture-notes.pdf"
    When the message is passed through the redaction layer
    Then the emitted line is exactly "Downloading file: lecture-notes.pdf"
  ```
- **Rules**:
  - RULE-SEC-002-A: The redaction function must use exact substring matching (case-sensitive) against each known-sensitive value; partial prefix matching alone is not sufficient.
  - RULE-SEC-002-B: The sensitive value set is updated atomically every time a new session token is obtained or the password is retrieved from the Keychain; stale values are removed immediately.
  - RULE-SEC-002-C: Log files inherit the same redaction guarantee as stdout/stderr — there is no "raw" log mode that bypasses redaction.
- **Dependencies**: REQ-SEC-001 (credential retrieval), REQ-AUTH-001 (session token lifecycle)

---

### REQ-SEC-003: HTTPS-Only Connections
- **Type**: Security
- **Priority**: Must-Have
- **Description**: Every outbound HTTP request made by the application must use the HTTPS scheme. This constraint is enforced at two points: (1) at startup, the configured `moodleUrl` value is validated and rejected if it uses the `http://` scheme; (2) at request execution time, any redirect response that leads to a URL with the `http://` scheme causes the request to be aborted immediately without following the redirect. No option, flag, or environment variable exists to relax either check.
- **Trigger**: (1) Application startup, when configuration is loaded and validated. (2) Receipt of any HTTP 3xx redirect response during an outbound request.
- **Input**: (1) The `moodleUrl` value from the configuration file. (2) The `Location` header value from a redirect response.
- **Output / Outcome**: (1) If `moodleUrl` starts with `http://`, the application exits immediately with code 1 and prints exactly: `"Error: moodleUrl must use HTTPS."`. (2) If a redirect `Location` is a plain `http://` URL, the request is aborted, no data is sent to or received from the downgraded URL, and an error is reported: `"Error: Redirect to plain HTTP detected for <original-url> — request aborted."`.
- **Error Conditions**:
  - `moodleUrl` is missing the scheme entirely: reject at startup with `"Error: moodleUrl is missing a URL scheme — must start with https://."`.
  - `moodleUrl` uses an unrecognised scheme (e.g., `ftp://`): reject at startup with `"Error: moodleUrl uses unsupported scheme '<scheme>' — must use https://."`.
  - Redirect `Location` header is absent or malformed: abort the request with `"Error: Malformed or missing Location header in redirect response from <url>."`.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Application rejects an http:// moodleUrl at startup
    Given the config file contains moodleUrl = "http://moodle.hwr-berlin.de"
    When the application starts
    Then it exits with exit code 1
    And prints "Error: moodleUrl must use HTTPS."
    And no network request is made

  Scenario: Application accepts a valid https:// moodleUrl at startup
    Given the config file contains moodleUrl = "https://moodle.hwr-berlin.de"
    When the application starts
    Then configuration validation succeeds
    And the application proceeds to the authentication phase

  Scenario: Application aborts a request that is redirected to HTTP
    Given a valid HTTPS session is active
    When an outbound request receives a 302 redirect with Location "http://moodle.hwr-berlin.de/file"
    Then the redirect is not followed
    And the request is aborted
    And an error "Error: Redirect to plain HTTP detected for <original-url> — request aborted." is reported
  ```
- **Rules**:
  - RULE-SEC-003-A: The scheme check is a string prefix check on the normalised (lowercased) URL — `http://` (exactly) is rejected; `https://` is required.
  - RULE-SEC-003-B: The redirect check applies to all redirect chains, not just the first hop; if any hop in a redirect chain leads to `http://`, the entire request is aborted.
  - RULE-SEC-003-C: There is no `--allow-http` flag, `insecure` config key, or any other mechanism to bypass HTTPS enforcement.
- **Dependencies**: REQ-SEC-008 (TLS validation), REQ-AUTH-001 (first network operation at startup)

---

### REQ-SEC-004: Session File Permissions
- **Type**: Security
- **Priority**: Must-Have
- **Description**: The session file `session.json` is always created with Unix file mode `0600` (owner read and write only; no permissions for group or others). At every application startup, if `session.json` already exists, its current permissions are inspected. If the permissions are broader than `0600` (i.e., any bit is set beyond owner read/write), they are corrected to `0600` immediately and a warning is logged. The application continues normally after the correction.
- **Trigger**: (1) Creation of `session.json` during the first successful login. (2) Application startup, when the session file is checked for existence.
- **Input**: (1) A new session data object to be persisted. (2) The file metadata of an existing `session.json`.
- **Output / Outcome**: (1) `session.json` is written to disk with mode `0600`. (2) If permissions are too broad at startup, they are corrected to `0600` and the warning `"Session file permissions were too broad — corrected to 0600."` is written to stderr.
- **Error Conditions**:
  - Permission correction fails (e.g., filesystem is read-only or user lacks ownership): abort with `"Error: Could not correct session file permissions: <reason>."` and do not proceed.
  - `session.json` is a symlink: resolve the symlink and apply the mode to the real file; log `"Warning: session.json is a symlink — permissions applied to target <resolved-path>."`.
  - `session.json` is owned by a different user: abort with `"Error: session.json is owned by a different user — refusing to modify."`.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: session.json is created with mode 0600
    Given no session.json exists
    When the user successfully logs in for the first time
    Then session.json is created
    And its Unix permissions are exactly 0600

  Scenario: Overly broad permissions are corrected at startup
    Given session.json exists with permissions 0644
    When the application starts
    Then the permissions of session.json are changed to 0600
    And a warning "Session file permissions were too broad — corrected to 0600." is written to stderr

  Scenario: Correct permissions are left unchanged at startup
    Given session.json exists with permissions 0600
    When the application starts
    Then the permissions of session.json remain 0600
    And no warning is emitted
  ```
- **Rules**:
  - RULE-SEC-004-A: The mode `0600` is hard-coded; there is no config key or CLI flag to change the required session file permissions.
  - RULE-SEC-004-B: The permission check is performed before any read of `session.json` content, so that no session data is consumed from a file with insecure permissions.
  - RULE-SEC-004-C: The correction is applied using the OS-level `chmod` equivalent (e.g., `fs.chmod` in Node.js) — not by deleting and recreating the file.
- **Dependencies**: REQ-AUTH-001 (session file is created during authentication), REQ-SEC-001 (session file must not contain plaintext credentials)

---

### REQ-SEC-005: Request Rate Limiting
- **Type**: Security
- **Priority**: Must-Have
- **Description**: A minimum enforced delay is inserted between consecutive outbound HTTP requests directed at the Moodle host, so that the scraper does not send requests faster than a human browsing session would. The default delay is 500 ms. The delay is configurable via the `requestDelayMs` key in the application config file. Only integer values in the inclusive range 100–5000 ms are accepted; values outside this range, non-integer values, and missing values cause a config validation error at startup. The delay is measured from the moment the previous response (or error) is received to the moment the next request is dispatched.
- **Trigger**: Completion of any outbound HTTP request to the Moodle host, immediately before the next request is dispatched.
- **Input**: The resolved `requestDelayMs` config value (integer, 100–5000).
- **Output / Outcome**: The application waits at least `requestDelayMs` milliseconds after the previous response before sending the next request. No two requests to the Moodle host are in-flight simultaneously (requests are serialised).
- **Error Conditions**:
  - `requestDelayMs` is below 100: reject at startup with `"Error: requestDelayMs must be at least 100 ms."`.
  - `requestDelayMs` is above 5000: reject at startup with `"Error: requestDelayMs must not exceed 5000 ms."`.
  - `requestDelayMs` is a non-integer number (e.g., `250.5`): reject at startup with `"Error: requestDelayMs must be an integer."`.
  - `requestDelayMs` is absent from config: use the default of 500 ms; do not error.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Requests are spaced by at least the configured delay
    Given requestDelayMs is set to 500
    When two consecutive HTTP requests are made to the Moodle host
    Then the second request is dispatched no earlier than 500 ms after the first response is received

  Scenario: Config validation rejects a delay below the minimum
    Given the config file sets requestDelayMs = 50
    When the application starts
    Then it exits with exit code 1
    And prints "Error: requestDelayMs must be at least 100 ms."

  Scenario: Config validation rejects a delay above the maximum
    Given the config file sets requestDelayMs = 9999
    When the application starts
    Then it exits with exit code 1
    And prints "Error: requestDelayMs must not exceed 5000 ms."

  Scenario: Missing requestDelayMs uses the default
    Given the config file does not contain a requestDelayMs key
    When the application starts
    Then configuration validation succeeds
    And the effective delay between requests is 500 ms
  ```
- **Rules**:
  - RULE-SEC-005-A: The valid range for `requestDelayMs` is [100, 5000] inclusive; both bounds are enforced as hard limits.
  - RULE-SEC-005-B: The delay is applied between ALL requests to the Moodle host, including authentication requests, page scrapes, and file downloads — not only between download requests.
  - RULE-SEC-005-C: Requests to non-Moodle hosts (e.g., a CDN serving file content) are exempt from this delay, but must still obey REQ-SEC-003 (HTTPS-only).
- **Dependencies**: REQ-AUTH-001, REQ-SCRAPE-001 (any requirement that dispatches HTTP requests)

---

### REQ-SEC-006: Honest User-Agent Header
- **Type**: Security
- **Priority**: Must-Have
- **Description**: Every outbound HTTP request made by the application includes the `User-Agent` request header set to exactly `moodle-scraper/<version> (educational-tool)`, where `<version>` is the application's current semantic version string read from the package manifest at startup. No browser User-Agent string (e.g., containing `Mozilla/`, `Chrome/`, `Safari/`, `Gecko/`) is ever used. The header is injected by a single centralised HTTP client instance so that no individual request can omit or override it.
- **Trigger**: Construction of any outbound HTTP request.
- **Input**: The application version string from the package manifest (e.g., `1.0.0`).
- **Output / Outcome**: Every HTTP request sent by the application includes the header `User-Agent: moodle-scraper/1.0.0 (educational-tool)` (version substituted at runtime). No request omits this header or uses a different value.
- **Error Conditions**:
  - Version string cannot be read from the package manifest at startup: abort with `"Error: Could not read application version from package manifest."`.
  - Version string is empty or not a valid semantic version (MAJOR.MINOR.PATCH): abort with `"Error: Application version '<value>' is not a valid semantic version."`.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: All requests carry the honest User-Agent header
    Given the application version is "1.2.3"
    When any HTTP request is made to the Moodle host
    Then the request includes the header "User-Agent: moodle-scraper/1.2.3 (educational-tool)"

  Scenario: A browser User-Agent string is never used
    Given the application is running in any mode (normal, verbose, dry-run)
    When any HTTP request is constructed
    Then the User-Agent header does not contain "Mozilla/", "Chrome/", "Safari/", or "Gecko/"

  Scenario: Missing version in package manifest causes startup abort
    Given the package manifest does not contain a version field
    When the application starts
    Then it exits with exit code 1
    And prints "Error: Could not read application version from package manifest."
  ```
- **Rules**:
  - RULE-SEC-006-A: The User-Agent string format is exactly `moodle-scraper/<semver> (educational-tool)` — no additional tokens, suffixes, or platform strings are appended.
  - RULE-SEC-006-B: The User-Agent header is set on the shared HTTP client instance at initialisation time; individual request call sites must not accept a `userAgent` override parameter.
  - RULE-SEC-006-C: The version string must satisfy the regex `^\d+\.\d+\.\d+$` (strict three-part semver, no pre-release or build metadata suffix).
- **Dependencies**: none

---

### REQ-SEC-007: State File Must Not Contain Secrets
- **Type**: Security
- **Priority**: Must-Have
- **Description**: The sync state file `.moodle-sync-state.json` is strictly limited to the following fields per resource record: `resourceId`, `localPath`, `lastModified`, `contentHash`, `downloadedAt`, `status`. Any attempt to write a field whose name or value matches a known-sensitive pattern (password, token, cookie, session key) into the state file is detected at the serialisation boundary and treated as a fatal error that immediately halts the process. No additional fields may be appended to a state record by any code path.
- **Trigger**: Any serialisation of a state record immediately before writing to `.moodle-sync-state.json`.
- **Input**: A state record object to be serialised to JSON.
- **Output / Outcome**: The state file contains only records with the seven permitted fields listed above. Attempting to serialise a record containing any other field — or a permitted field whose value matches a sensitive-value pattern — halts the process with a fatal error.
- **Error Conditions**:
  - A state record contains an unexpected field (any field not in the permitted list): halt immediately with `"Fatal: Attempted to write unexpected field '<fieldName>' to state file — this is a bug."` and exit with code 2.
  - A permitted field's value matches a known-sensitive pattern (e.g., a string that equals the current session token): halt immediately with `"Fatal: Sensitive value detected in state record field '<fieldName>' — this is a bug."` and exit with code 2.
  - State file write fails for non-security reasons (e.g., disk full): report `"Error: Could not write state file: <reason>."` and exit with code 1.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: State file is written with only permitted fields
    Given a completed resource download
    When the state record is serialised and written
    Then the resulting JSON object contains exactly the fields: resourceId, localPath, lastModified, contentHash, downloadedAt, status
    And no other fields are present

  Scenario: Process halts if an unexpected field is present in a state record
    Given a state record object that contains an extra field "authToken"
    When the serialisation function is called
    Then the process halts with exit code 2
    And prints "Fatal: Attempted to write unexpected field 'authToken' to state file — this is a bug."

  Scenario: Process halts if a sensitive value is detected in a state record field
    Given the current session token is "supersecrettoken"
    And a state record has localPath set to "supersecrettoken"
    When the serialisation function is called
    Then the process halts with exit code 2
    And prints "Fatal: Sensitive value detected in state record field 'localPath' — this is a bug."
  ```
- **Rules**:
  - RULE-SEC-007-A: The permitted field list is fixed: `["resourceId", "localPath", "lastModified", "contentHash", "downloadedAt", "status"]`; it cannot be extended at runtime.
  - RULE-SEC-007-B: The sensitive-value check at serialisation uses the same redaction set as REQ-SEC-002 (current password, session token, Cookie header value).
  - RULE-SEC-007-C: Exit code 2 is reserved specifically for security-invariant violations (distinguished from exit code 1 used for operational errors).
- **Dependencies**: REQ-SEC-001 (defines what values are sensitive), REQ-SEC-002 (sensitive value set), REQ-SYNC-001 (state file schema)

---

### REQ-SEC-008: TLS Certificate Validation
- **Type**: Security
- **Priority**: Must-Have
- **Description**: TLS certificates are fully validated for every outbound HTTPS request. Full validation means: the certificate chain is verified against the OS trust store, the hostname matches the certificate's Subject Alternative Name or Common Name, and the certificate has not expired. There is no CLI flag, config key, environment variable, or code path that disables, bypasses, or relaxes certificate validation in any way — including development or test environments. If certificate validation fails for any reason, the request is aborted and an error is reported.
- **Trigger**: The TLS handshake phase of any outbound HTTPS request.
- **Input**: The TLS certificate presented by the remote server during the handshake.
- **Output / Outcome**: If validation succeeds, the request proceeds normally. If validation fails, the request is aborted with no data sent or received, and the error `"TLS certificate validation failed for <host>: <reason>."` is reported to stderr.
- **Error Conditions**:
  - Certificate is expired: abort with `"TLS certificate validation failed for <host>: certificate has expired."`.
  - Certificate hostname mismatch: abort with `"TLS certificate validation failed for <host>: hostname mismatch."`.
  - Certificate chain is untrusted: abort with `"TLS certificate validation failed for <host>: untrusted certificate chain."`.
  - Self-signed certificate: abort with `"TLS certificate validation failed for <host>: self-signed certificate."`.
  - Any other TLS error: abort with `"TLS certificate validation failed for <host>: <underlying-tls-error-message>."`.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Valid TLS certificate allows the request to proceed
    Given the target host presents a valid, trusted, non-expired TLS certificate
    When an HTTPS request is made to that host
    Then the TLS handshake succeeds
    And the request proceeds to send and receive data normally

  Scenario: Expired certificate aborts the request
    Given the target host presents a TLS certificate that has expired
    When an HTTPS request is made to that host
    Then the request is aborted
    And stderr contains "TLS certificate validation failed for <host>: certificate has expired."
    And no request data is transmitted

  Scenario: Self-signed certificate aborts the request
    Given the target host presents a self-signed TLS certificate
    When an HTTPS request is made to that host
    Then the request is aborted
    And stderr contains "TLS certificate validation failed for <host>: self-signed certificate."

  Scenario: No bypass mechanism exists
    Given the application source code and configuration schema
    When all config keys, CLI flags, and environment variable names are enumerated
    Then none of them have the effect of disabling TLS certificate validation
  ```
- **Rules**:
  - RULE-SEC-008-A: The HTTP client must be initialised with certificate validation enabled and no `rejectUnauthorized: false` equivalent — this setting must not appear anywhere in source code, including test helpers or mock servers.
  - RULE-SEC-008-B: Tests that require a mock HTTPS server must use a locally-trusted certificate (e.g., generated by `mkcert`) rather than disabling validation.
  - RULE-SEC-008-C: The `<reason>` in the error message is the normalised TLS error description from the underlying runtime, not a generic fallback string, so the user receives actionable information.
- **Dependencies**: REQ-SEC-003 (HTTPS-only; TLS validation is only meaningful if HTTPS is enforced)

---

## Error Handling

### REQ-ERR-001: Network Timeout and Retry
- **Type**: Non-Functional
- **Priority**: Must-Have
- **Description**: Every outgoing HTTP request must enforce a per-request connect timeout and a per-request read timeout. Both values must be configurable via CLI flags or a config file. When either timeout fires, the request must be retried with exponential backoff. After exhausting all retries, the affected resource must be skipped and the scrape must continue.
- **Trigger**: An HTTP request either fails to establish a TCP connection within the connect-timeout window, or fails to receive a complete response body within the read-timeout window.
- **Input**:
  - Connect timeout value (default: 10 seconds; configurable)
  - Read timeout value (default: 60 seconds; configurable)
  - URL of the resource being fetched
  - Retry count state for the current resource (starts at 0)
- **Output / Outcome**:
  - On timeout with retries remaining: the request is retried after a backoff delay (2 s before retry 1, 4 s before retry 2, 8 s before retry 3).
  - On final failure (3rd retry exhausted): the resource is skipped, an error entry is written to the log containing the resource URL, and the scrape continues with the next resource.
  - No uncaught exception is propagated to the top level.
- **Error Conditions**:
  - Connect timeout fires on attempt 1, 2, or 3: apply backoff delay then retry.
  - Read timeout fires on attempt 1, 2, or 3: apply backoff delay then retry.
  - Both timeouts fire across the 3 retries: log error with URL, skip resource, continue.
  - Configured timeout value is not a positive integer: reject at startup with message "Invalid timeout value: <value> — must be a positive integer (seconds)." Exit code 1.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Timeout recovers on second attempt
    Given a resource URL that times out on the first request
    And the retry count for that resource is 0
    When the connect timeout fires
    Then the scraper waits 2 seconds
    And retries the request
    And if the second attempt succeeds, the resource is downloaded normally

  Scenario: Resource skipped after 3 timeout failures
    Given a resource URL that times out on every attempt
    When the third retry also times out
    Then the scraper logs an error containing the resource URL
    And skips that resource
    And continues processing the next resource without exiting

  Scenario: Custom timeout values are respected
    Given the user has configured connect-timeout=5 and read-timeout=30
    When an HTTP request is made
    Then the connect phase aborts after 5 seconds if no connection is established
    And the read phase aborts after 30 seconds if no full response is received
  ```
- **Rules**:
  - RULE-ERR-001-A: The default connect timeout is 10 seconds. The default read timeout is 60 seconds. Both are independently configurable.
  - RULE-ERR-001-B: Retry delays follow strict exponential backoff: 2 s, 4 s, 8 s (i.e., delay = 2^attempt seconds where attempt is 1-indexed).
  - RULE-ERR-001-C: The maximum number of retries per resource is 3. After 3 failures the resource is skipped; no fourth attempt is ever made.
  - RULE-ERR-001-D: Each skipped resource due to timeout is logged at ERROR level with the exact URL before the scrape continues.
- **Dependencies**: REQ-CLI-* (configuration flags), REQ-SCRAPE-* (HTTP request layer)

---

### REQ-ERR-002: HTTP 401 Handling
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: An HTTP 401 Unauthorized response indicates that the current session has expired. The scraper must attempt a single re-authentication using the credentials stored in the OS Keychain. If re-authentication succeeds, the original failed request is retried exactly once. If re-authentication fails for any reason, the entire scrape must be aborted immediately with a specific exit code and message.
- **Trigger**: Any HTTP response with status code 401 is received during a scrape.
- **Input**:
  - The HTTP 401 response from the Moodle server.
  - Stored credentials from the OS Keychain (username + password).
  - The original request (URL, method, headers) that produced the 401.
- **Output / Outcome**:
  - If re-authentication succeeds: the original request is retried once. If the retry returns 2xx, the resource is processed normally. If the retry returns another 401, the scrape is aborted (same as re-auth failure path).
  - If re-authentication fails: scrape halts immediately. All pending downloads are abandoned. The state file is flushed. Exit code 2 is returned. The message "Session expired and re-authentication failed." is printed to stderr.
- **Error Conditions**:
  - Keychain lookup fails (credentials not found): treat as re-authentication failure; abort with exit code 2.
  - Re-authentication HTTP request itself times out: treat as re-authentication failure; abort with exit code 2.
  - The retried original request returns 401 again: treat as re-authentication failure; abort with exit code 2.
  - 401 received during the re-authentication request itself: abort with exit code 2.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Session expires mid-scrape and re-auth succeeds
    Given the scraper is running and has a valid session
    And a resource request returns HTTP 401
    When the scraper retrieves credentials from the OS Keychain
    And re-authentication to Moodle succeeds
    Then the original resource request is retried once
    And if the retry returns 2xx the resource is downloaded normally
    And the scrape continues from where it left off

  Scenario: Session expires and re-auth fails
    Given the scraper is running
    And a resource request returns HTTP 401
    When the scraper attempts re-authentication
    And re-authentication fails (e.g. wrong credentials or network error)
    Then the scrape is aborted immediately
    And the state file is flushed with all completed downloads recorded
    And "Session expired and re-authentication failed." is printed to stderr
    And the process exits with code 2

  Scenario: Re-auth succeeds but retry also returns 401
    Given re-authentication completed successfully
    When the retried original request returns HTTP 401
    Then the scrape is aborted with exit code 2
    And "Session expired and re-authentication failed." is printed to stderr
  ```
- **Rules**:
  - RULE-ERR-002-A: Re-authentication is attempted at most once per scrape session, not once per 401.
  - RULE-ERR-002-B: The original failed request is retried at most once after successful re-authentication.
  - RULE-ERR-002-C: Exit code on unrecoverable 401 is exactly 2.
  - RULE-ERR-002-D: The state file must be flushed before process exit so that successfully downloaded resources are not re-downloaded on the next run.
- **Dependencies**: REQ-AUTH-* (authentication flow), REQ-SYNC-* (state file), REQ-SEC-* (Keychain access)

---

### REQ-ERR-003: HTTP 403 Handling
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: An HTTP 403 Forbidden response indicates that the authenticated user does not have permission to access a specific resource. This is a per-resource condition and must never abort the entire scrape. The resource is silently skipped after emitting a structured warning.
- **Trigger**: Any HTTP response with status code 403 is received for a specific resource during a scrape.
- **Input**:
  - The HTTP 403 response from the Moodle server.
  - The resource name as determined from the course/section page (used in the warning message).
  - The URL of the resource.
- **Output / Outcome**:
  - The resource is skipped (not downloaded, not added to the state file as completed).
  - A warning message is emitted in the exact format: `Access denied: <resource-name> (<url>)`
  - The scrape continues with the next resource.
  - The final scrape summary includes a count of resources skipped due to 403.
- **Error Conditions**:
  - Resource name cannot be determined from page context: use the URL path's last segment as the resource name in the warning message.
  - 403 on a course-level page (not a leaf resource): skip that entire course subtree, emit warning with the course name, continue with remaining courses.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Single resource returns 403
    Given the scraper is processing a course with multiple resources
    And one resource returns HTTP 403
    When the 403 response is received
    Then a warning is emitted matching "Access denied: <resource-name> (<url>)"
    And the resource is skipped
    And the scrape continues and all other resources in the course are processed

  Scenario: 403 is never a fatal error
    Given every resource in a course returns HTTP 403
    When all 403 responses are received
    Then a warning is emitted for each resource
    And the scraper does not exit prematurely
    And the scrape completes with exit code 0
    And the final summary reports the count of 403-skipped resources
  ```
- **Rules**:
  - RULE-ERR-003-A: HTTP 403 is never a fatal error at any scope (resource, section, or course level).
  - RULE-ERR-003-B: The warning message format is exactly: `Access denied: <resource-name> (<url>)` with no deviation.
  - RULE-ERR-003-C: The final scrape summary must include a "Skipped (access denied): N" line when N > 0.
  - RULE-ERR-003-D: A 403 resource is not recorded in the state file as successfully synced; it will be retried on the next run.
- **Dependencies**: REQ-SCRAPE-* (resource enumeration), REQ-CLI-* (summary output)

---

### REQ-ERR-004: HTTP 404 Handling
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: An HTTP 404 Not Found response indicates that a resource previously listed on a course page no longer exists on the server. The resource must be skipped, a warning emitted, and the resource URL marked as an orphan in the state file so that future runs are aware of its status.
- **Trigger**: Any HTTP response with status code 404 is received for a specific resource during a scrape.
- **Input**:
  - The HTTP 404 response from the Moodle server.
  - The resource name as determined from the course/section page.
  - The URL of the resource.
  - The current state file.
- **Output / Outcome**:
  - A warning is emitted in the exact format: `Not found: <resource-name> (<url>)`
  - The resource URL is written to the state file under an `orphans` key with the timestamp of the current run.
  - The resource is not downloaded.
  - The scrape continues with the next resource.
- **Error Conditions**:
  - State file is read-only and cannot be updated: log an additional warning "Could not update state file with orphan: <url>", continue.
  - Resource name cannot be determined: use the URL path's last segment as the resource name.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Resource returns 404
    Given the scraper encounters a resource URL
    And the server returns HTTP 404 for that URL
    When the 404 response is received
    Then a warning is emitted matching "Not found: <resource-name> (<url>)"
    And the resource URL is recorded in the state file under the "orphans" key
    And the scrape continues with the next resource

  Scenario: Orphaned resource is tracked across runs
    Given a resource was marked as an orphan in the state file during a previous run
    When the scraper starts a new run and encounters that same URL
    Then the resource is still attempted (the orphan status does not permanently suppress it)
    And if it returns 404 again it is re-recorded as an orphan with the new run's timestamp
  ```
- **Rules**:
  - RULE-ERR-004-A: The warning message format is exactly: `Not found: <resource-name> (<url>)` with no deviation.
  - RULE-ERR-004-B: The orphan entry in the state file must include the resource URL and an ISO 8601 timestamp of the run that detected the 404.
  - RULE-ERR-004-C: Orphan status does not permanently suppress future download attempts; each run re-attempts all resources.
  - RULE-ERR-004-D: HTTP 404 is never a fatal error; the scrape must always continue.
- **Dependencies**: REQ-SYNC-* (state file structure), REQ-SCRAPE-* (resource enumeration)

---

### REQ-ERR-005: HTTP 429 Handling
- **Type**: Non-Functional
- **Priority**: Must-Have
- **Description**: An HTTP 429 Too Many Requests response indicates that the Moodle server has applied rate limiting. The scraper must honour the server-specified wait duration from the `Retry-After` response header before retrying. If the header is absent, a default wait of 60 seconds is used. The resource is retried up to 3 times before being skipped.
- **Trigger**: Any HTTP response with status code 429 is received for a specific resource during a scrape.
- **Input**:
  - The HTTP 429 response, including its headers.
  - `Retry-After` header value (integer seconds or HTTP date string; may be absent).
  - Retry count state for the current resource.
- **Output / Outcome**:
  - The scraper pauses for the duration specified by `Retry-After` (or 60 seconds if absent).
  - After the wait, the request is retried.
  - If the retry succeeds (2xx), the resource is downloaded normally.
  - If retries are exhausted (3 total): the resource is skipped, an error is logged containing the URL, and the scrape continues.
- **Error Conditions**:
  - `Retry-After` header is present but not a valid integer or HTTP date: default to 60 seconds and log "Invalid Retry-After header value '<value>' — defaulting to 60 s."
  - `Retry-After` specifies a wait exceeding 600 seconds: cap the wait at 600 seconds and log "Retry-After value <N> s exceeds cap of 600 s — waiting 600 s."
  - Third retry also returns 429: skip the resource, log error with URL, continue scrape.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Server returns 429 with Retry-After header
    Given a resource request returns HTTP 429
    And the response includes "Retry-After: 30"
    When the 429 is received
    Then the scraper waits exactly 30 seconds
    And retries the request once
    And if the retry returns 2xx the resource is downloaded normally

  Scenario: Server returns 429 without Retry-After header
    Given a resource request returns HTTP 429
    And the response does not include a Retry-After header
    When the 429 is received
    Then the scraper waits exactly 60 seconds
    And retries the request

  Scenario: Resource skipped after 3 rate-limit rejections
    Given a resource has been rate-limited and retried twice already
    When the third attempt also returns 429
    Then the resource is skipped
    And an error is logged containing the resource URL
    And the scrape continues with the next resource
  ```
- **Rules**:
  - RULE-ERR-005-A: The `Retry-After` header value is treated as a duration in seconds. If it is an HTTP date string, it must be converted to a relative duration.
  - RULE-ERR-005-B: The default wait when `Retry-After` is absent is exactly 60 seconds.
  - RULE-ERR-005-C: The maximum wait enforced by the scraper is 600 seconds regardless of the header value.
  - RULE-ERR-005-D: The maximum number of retries per resource after 429 responses is 3.
  - RULE-ERR-005-E: The scraper must not make any further requests to the same server while waiting out a 429; all pending requests are paused.
- **Dependencies**: REQ-SCRAPE-* (HTTP request layer), REQ-ERR-001 (timeout/retry machinery)

---

### REQ-ERR-006: HTTP 5xx Handling
- **Type**: Non-Functional
- **Priority**: Must-Have
- **Description**: Any HTTP 5xx response (500, 502, 503, 504, etc.) indicates a transient server error. The scraper must retry the affected resource with exponential backoff up to 3 times. If all retries fail, the resource is skipped and the scrape continues. The final scrape summary must include a total count of resources that failed due to 5xx errors.
- **Trigger**: Any HTTP response with a status code in the range 500–599 is received for a specific resource.
- **Input**:
  - The HTTP 5xx response and its status code.
  - Retry count state for the current resource (starts at 0).
  - URL of the resource.
- **Output / Outcome**:
  - Retry 1 is made after a 2-second delay; retry 2 after 4 seconds; retry 3 after 8 seconds.
  - If any retry returns 2xx, the resource is downloaded normally.
  - If all 3 retries return 5xx (or timeout): the resource is skipped, an error is logged with the URL and final HTTP status code, and the scrape continues.
  - The final summary includes a line: "Server errors (5xx): N resource(s) skipped."
- **Error Conditions**:
  - A retry attempt itself times out (per REQ-ERR-001): counts as a failed attempt; the timeout retry and the 5xx retry budgets are consumed together (i.e., the combined retry limit is 3 attempts total per resource).
  - All resources in a course return 5xx: the course is skipped in its entirety; a single summary line is emitted for the course; the scrape continues to the next course.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Resource recovers on second attempt after 500
    Given a resource request returns HTTP 500
    And the retry count is 0
    When the scraper applies a 2-second backoff
    And retries the request
    And the second attempt returns HTTP 200
    Then the resource is downloaded normally

  Scenario: Resource skipped after 3 consecutive 5xx responses
    Given a resource returns 5xx on every attempt
    When the third retry also returns 5xx
    Then the resource is skipped
    And an error entry is logged containing the URL and the final HTTP status code
    And the scrape continues with the next resource

  Scenario: Final summary includes 5xx failure count
    Given a completed scrape where 3 resources were skipped due to 5xx errors
    When the scrape finishes
    Then the final summary includes the line "Server errors (5xx): 3 resource(s) skipped."
  ```
- **Rules**:
  - RULE-ERR-006-A: Retry delays are 2 s, 4 s, 8 s (exponential backoff; not randomised).
  - RULE-ERR-006-B: The maximum retry count per resource is 3; no fourth attempt is ever made.
  - RULE-ERR-006-C: The final scrape summary must always include the "Server errors (5xx): N resource(s) skipped." line; N may be 0.
  - RULE-ERR-006-D: All 5xx status codes (500–599) are treated identically; no special-casing of individual codes.
- **Dependencies**: REQ-ERR-001 (backoff machinery), REQ-SCRAPE-* (resource enumeration), REQ-CLI-* (summary output)

---

### REQ-ERR-007: Moodle Maintenance Mode Detection
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: Moodle serves a maintenance page instead of normal content when placed in maintenance mode. The scraper must detect this condition from the HTTP response body and abort the entire scrape immediately with a specific exit code and human-readable message.
- **Trigger**: An HTTP response body for any Moodle page contains the string `siteinmaintenance` or a `<div class="maintenance-mode">` element.
- **Input**:
  - The HTTP response body (HTML) of any fetched Moodle page.
  - The detection patterns: literal string `siteinmaintenance` anywhere in the body; OR a `<div` element with `class` attribute containing `maintenance-mode`.
- **Output / Outcome**:
  - All in-progress downloads are stopped immediately.
  - The in-progress `.part` file (if any) is deleted.
  - The state file is flushed with all previously completed downloads recorded.
  - The message `Moodle is currently in maintenance mode. Please try again later.` is printed to stderr.
  - The process exits with code 3.
- **Error Conditions**:
  - State file cannot be flushed on abort: log "Warning: could not save state file on maintenance abort: <OS error>", then exit with code 3 regardless.
  - Maintenance page detected on the very first request (e.g., login page): abort before any downloads begin; exit code 3.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Maintenance page detected mid-scrape via string match
    Given the scraper is actively downloading resources
    When any fetched page body contains the string "siteinmaintenance"
    Then all in-progress downloads are stopped
    And any .part file is deleted
    And the state file is flushed
    And "Moodle is currently in maintenance mode. Please try again later." is printed to stderr
    And the process exits with code 3

  Scenario: Maintenance page detected via div class
    Given a fetched page body contains '<div class="maintenance-mode">'
    When the page is parsed
    Then the same abort sequence is triggered and the process exits with code 3

  Scenario: Maintenance page detected on first request
    Given Moodle is in maintenance mode before the scrape starts
    When the scraper fetches the login page and it contains "siteinmaintenance"
    Then the scraper aborts with exit code 3 before downloading any files
  ```
- **Rules**:
  - RULE-ERR-007-A: Detection checks both patterns independently; matching either one triggers the abort.
  - RULE-ERR-007-B: The check is performed on every fetched HTML page, not just a specific URL.
  - RULE-ERR-007-C: Exit code on maintenance detection is exactly 3.
  - RULE-ERR-007-D: The state file must be flushed before exit so that already-completed downloads are not repeated on the next run.
- **Dependencies**: REQ-SCRAPE-* (page fetching), REQ-SYNC-* (state file), REQ-ERR-012 (abort/cleanup sequence)

---

### REQ-ERR-008: Disk Full During Download
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: When a file write fails because the disk has no space remaining (OS error ENOSPC), the scraper must clean up the incomplete file, log the condition, and continue downloading other files. After all downloads complete, a summary warning must be printed if any files were skipped for this reason.
- **Trigger**: An `ENOSPC` (no space left on device) OS error is raised during a write to a `.part` file.
- **Input**:
  - The ENOSPC error from the OS.
  - The path of the `.part` file currently being written.
  - The filename of the target resource (without the `.part` suffix).
  - The count of files already skipped due to disk full in the current run.
- **Output / Outcome**:
  - The `.part` file is deleted immediately.
  - A log entry is written: `Disk full — skipped: <filename>` where `<filename>` is the intended final filename.
  - The scrape continues with the next resource.
  - After all downloads complete, if the skip count > 0: `Warning: <N> file(s) skipped due to insufficient disk space.` is printed to stderr.
- **Error Conditions**:
  - Deletion of the `.part` file itself fails (e.g., permission error): log "Warning: could not delete partial file <path>: <OS error>" and continue.
  - ENOSPC occurs during state file flush: log "Critical: disk full — could not save state file. Run again after freeing disk space." and exit with code 5.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Single file skipped due to ENOSPC
    Given the scraper is writing a file to a .part path
    When the OS raises an ENOSPC error
    Then the .part file is deleted
    And a log entry is written matching "Disk full — skipped: <filename>"
    And the scrape continues with the next resource

  Scenario: Summary warning printed after disk-full skips
    Given 3 files were skipped due to ENOSPC during the scrape
    When the scrape finishes
    Then "Warning: 3 file(s) skipped due to insufficient disk space." is printed to stderr

  Scenario: No warning printed when no disk-full skips occurred
    Given no ENOSPC errors occurred during the scrape
    When the scrape finishes
    Then no disk-space warning is printed
  ```
- **Rules**:
  - RULE-ERR-008-A: Only ENOSPC errors trigger this handler; other write errors (e.g., EPERM) are handled separately.
  - RULE-ERR-008-B: The `.part` file must be deleted before the scrape moves on to the next resource.
  - RULE-ERR-008-C: The log message format is exactly: `Disk full — skipped: <filename>`.
  - RULE-ERR-008-D: The post-run warning format is exactly: `Warning: <N> file(s) skipped due to insufficient disk space.` where N is the precise count.
  - RULE-ERR-008-E: A resource skipped due to ENOSPC is not recorded in the state file as completed; it will be retried on the next run.
- **Dependencies**: REQ-FS-* (file write / .part pattern), REQ-SCRAPE-* (download loop)

---

### REQ-ERR-009: Output Directory Inaccessible
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: Before any downloads begin, the scraper must verify that the output directory can be created (if it does not exist) and written to. If either check fails, the scraper must print a specific error message to stderr and exit immediately — no downloads must start and no partial state changes must be made.
- **Trigger**: At startup, the scraper attempts to create or verify write access to the configured output directory.
- **Input**:
  - The configured output directory path (from CLI flag or default).
  - The OS error returned when creation or write-access verification fails.
- **Output / Outcome**:
  - The error message is printed to stderr in the exact format: `Error: cannot write to output directory <path>: <OS error message>` where `<OS error message>` is the human-readable OS error string.
  - The process exits with code 4.
  - No files are created or modified anywhere on the filesystem.
  - No network requests are made.
- **Error Conditions**:
  - Path does not exist and `mkdir` fails with EPERM: print error, exit code 4.
  - Path exists but is a file, not a directory: print error message including "is not a directory", exit code 4.
  - Path exists and is a directory but is not writable: print error with OS error string, exit code 4.
  - Path string is empty: print "Error: output directory path must not be empty.", exit code 4.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Output directory cannot be created (permission denied)
    Given the output directory path points to a location where the user lacks write permission
    When the scraper starts
    Then no network requests are made
    And "Error: cannot write to output directory <path>: permission denied" is printed to stderr
    And the process exits with code 4

  Scenario: Output directory is a file
    Given the output directory path points to an existing regular file
    When the scraper starts
    Then "Error: cannot write to output directory <path>: is not a directory" is printed to stderr
    And the process exits with code 4

  Scenario: Valid output directory
    Given the output directory exists and is writable
    When the scraper starts
    Then no error is printed for the directory
    And the scraper proceeds to authenticate and scrape
  ```
- **Rules**:
  - RULE-ERR-009-A: The output directory check is the first operation performed after CLI argument parsing; it precedes all network activity.
  - RULE-ERR-009-B: Exit code for inaccessible output directory is exactly 4.
  - RULE-ERR-009-C: The error message format is exactly: `Error: cannot write to output directory <path>: <OS error message>`.
  - RULE-ERR-009-D: On this error path the scraper must not create any files, make any network requests, or read any credentials.
- **Dependencies**: REQ-CLI-* (argument parsing), REQ-FS-* (output directory configuration)

---

### REQ-ERR-010: Corrupt State File
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: If the state file exists at startup but cannot be parsed as valid JSON, the scraper must not abort. Instead, it must rename the corrupt file to a `.bak` backup, start with an empty in-memory state (triggering a full re-sync), and log a structured warning describing what happened.
- **Trigger**: At startup, the state file `.moodle-sync-state.json` is found to exist but fails JSON parsing.
- **Input**:
  - The path to `.moodle-sync-state.json`.
  - The JSON parse error detail.
  - The path of the backup file: `.moodle-sync-state.json.bak`.
- **Output / Outcome**:
  - The corrupt state file is renamed to `.moodle-sync-state.json.bak`, overwriting any previously existing backup at that path.
  - In-memory state is initialised as empty (equivalent to a first run).
  - The following warning is logged (exact format): `State file was corrupt — reset to empty. A full re-sync will occur this run. Backup saved to .moodle-sync-state.json.bak.`
  - The scrape proceeds normally, re-downloading all resources.
- **Error Conditions**:
  - Rename of the corrupt file fails (e.g., EPERM): log "Error: could not rename corrupt state file <path>: <OS error>. Proceeding with empty state." and continue with empty state; do not exit.
  - State file is valid JSON but missing required top-level keys: treat as corrupt (same handling).
  - State file exists, is empty (0 bytes): treat as corrupt (same handling).
- **Acceptance Criteria**:
  ```gherkin
  Scenario: State file is malformed JSON
    Given .moodle-sync-state.json exists and contains invalid JSON
    When the scraper starts
    Then .moodle-sync-state.json is renamed to .moodle-sync-state.json.bak
    And the scraper logs "State file was corrupt — reset to empty. A full re-sync will occur this run. Backup saved to .moodle-sync-state.json.bak."
    And the scraper runs a full re-sync as if it were the first run

  Scenario: Backup is overwritten if it already exists
    Given .moodle-sync-state.json.bak already exists from a previous run
    And .moodle-sync-state.json is corrupt
    When the scraper starts
    Then .moodle-sync-state.json.bak is overwritten with the newly corrupt file
    And no additional warning about the existing backup is emitted

  Scenario: Valid state file is not treated as corrupt
    Given .moodle-sync-state.json exists and is valid JSON with all required keys
    When the scraper starts
    Then the state file is loaded normally
    And no backup is created
  ```
- **Rules**:
  - RULE-ERR-010-A: The backup filename is exactly `.moodle-sync-state.json.bak`; no timestamp suffix is appended.
  - RULE-ERR-010-B: An existing `.bak` file is always overwritten; the scraper does not accumulate multiple backup files.
  - RULE-ERR-010-C: The warning message is exactly: `State file was corrupt — reset to empty. A full re-sync will occur this run. Backup saved to .moodle-sync-state.json.bak.`
  - RULE-ERR-010-D: A corrupt state file must never cause the scraper to exit; it must always degrade gracefully to an empty state.
  - RULE-ERR-010-E: An empty (0-byte) state file and a structurally incomplete JSON object are both treated as corrupt.
- **Dependencies**: REQ-SYNC-* (state file schema and path), REQ-FS-* (file rename operation)

---

### REQ-ERR-011: Unexpected Moodle Page Structure
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: Moodle's HTML structure may change across versions or due to custom theme overrides. If the scraper's expected CSS selectors find no matching elements on a fetched page, it must log a structured warning and skip that page rather than crashing or silently producing wrong output.
- **Trigger**: A CSS selector used to locate courses, sections, or resource items on a fetched Moodle HTML page returns an empty match set.
- **Input**:
  - The fetched page URL.
  - The CSS selector string that found no matches.
  - The list of selectors that were tried (for diagnostic purposes).
- **Output / Outcome**:
  - A warning is logged in the exact format: `Unexpected page structure at <url> — expected <selector>, found nothing. Skipping.`
  - The page is skipped; no child resources are enqueued from it.
  - The scrape continues processing all other pages in the queue.
  - The process does not crash (no unhandled exception propagates).
- **Error Conditions**:
  - Multiple selectors fail on the same page: one warning is emitted per failed selector.
  - The page itself could not be fetched (network error): this is handled by REQ-ERR-001/005/006, not this requirement.
  - All pages in a course return unexpected structure: course is silently skipped; the final summary includes the count of pages with unexpected structure.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Course list selector finds no elements
    Given a fetched Moodle dashboard page
    When the CSS selector for the course list returns no matching elements
    Then a warning is logged matching "Unexpected page structure at <url> — expected <selector>, found nothing. Skipping."
    And no courses are enqueued from that page
    And the scraper does not crash
    And any previously enqueued pages continue to be processed

  Scenario: Resource list selector fails on a section page
    Given a fetched course section page
    When the CSS selector for resource items returns no matching elements
    Then a warning is logged with the section URL and the failed selector
    And the section is skipped
    And other sections in the same course are still processed

  Scenario: Normal page structure produces no warning
    Given a fetched page where all expected selectors return matches
    When the page is parsed
    Then no "unexpected page structure" warning is emitted
  ```
- **Rules**:
  - RULE-ERR-011-A: The warning message format is exactly: `Unexpected page structure at <url> — expected <selector>, found nothing. Skipping.`
  - RULE-ERR-011-B: A zero-match result from a CSS selector must never raise an unhandled exception.
  - RULE-ERR-011-C: The final scrape summary must include a count of pages skipped due to unexpected structure when that count is greater than 0.
  - RULE-ERR-011-D: The set of expected selectors is defined in a single, centralised configuration location in the source code (not scattered across multiple files).
- **Dependencies**: REQ-SCRAPE-* (page parsing), REQ-CLI-* (summary output)

---

### REQ-ERR-012: Graceful Shutdown on SIGINT/SIGTERM
- **Type**: Non-Functional
- **Priority**: Must-Have
- **Description**: When the user interrupts the scraper (Ctrl+C) or the process receives a termination signal, the scraper must complete the current atomic file write or clean up the in-progress partial file, persist all progress to the state file, print a confirmation message, and exit cleanly with code 0.
- **Trigger**: The process receives `SIGINT` (signal 2) or `SIGTERM` (signal 15) at any point during execution.
- **Input**:
  - The received OS signal (SIGINT or SIGTERM).
  - The path of any `.part` file currently being written (may be none).
  - The current in-memory state (list of all completed downloads in this run).
- **Output / Outcome**:
  1. If a `.part` file write is in progress and can be completed atomically within 5 seconds: complete the write, rename `.part` to the final filename, record in state.
  2. Otherwise: delete the `.part` file immediately.
  3. Flush the in-memory state to `.moodle-sync-state.json` on disk.
  4. Print `Interrupted. Progress saved to state file.` to stdout.
  5. Exit with code 0.
- **Error Conditions**:
  - State file flush fails on signal: log "Warning: could not save state on interrupt: <OS error>" to stderr; exit with code 0 regardless.
  - `.part` file deletion fails: log "Warning: could not delete partial file <path>: <OS error>" to stderr; continue shutdown sequence.
  - A second SIGINT is received while the shutdown sequence is in progress: force-exit immediately with code 130 without further cleanup.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: User presses Ctrl+C during a download
    Given the scraper is actively downloading a file to a .part path
    When the user presses Ctrl+C (SIGINT)
    Then the .part file is deleted
    And the state file is flushed with all previously completed downloads
    And "Interrupted. Progress saved to state file." is printed to stdout
    And the process exits with code 0

  Scenario: SIGTERM received between downloads
    Given the scraper has completed several downloads and is between requests
    When SIGTERM is received
    Then the state file is flushed
    And "Interrupted. Progress saved to state file." is printed to stdout
    And the process exits with code 0

  Scenario: Second SIGINT during shutdown
    Given the shutdown sequence has started following a first SIGINT
    When a second SIGINT is received before shutdown completes
    Then the process exits immediately with code 130
  ```
- **Rules**:
  - RULE-ERR-012-A: Both SIGINT and SIGTERM trigger the identical shutdown sequence.
  - RULE-ERR-012-B: Exit code on graceful signal shutdown is exactly 0.
  - RULE-ERR-012-C: The shutdown sequence must complete within 10 seconds; if it has not finished in 10 seconds, the process force-exits with code 130.
  - RULE-ERR-012-D: The message `Interrupted. Progress saved to state file.` must be printed to stdout (not stderr) so it is visible in interactive terminals regardless of stderr redirection.
  - RULE-ERR-012-E: A second SIGINT during the shutdown sequence exits immediately with code 130.
- **Dependencies**: REQ-SYNC-* (state file), REQ-FS-* (.part file pattern), REQ-ERR-008 (partial file cleanup)

---

### REQ-ERR-013: Stale Partial File Cleanup on Startup
- **Type**: Functional
- **Priority**: Must-Have
- **Description**: If a previous run was interrupted (crash, power loss, forced kill) it may have left `.part` files in the output directory. On startup, before any scraping begins, the scraper must locate and delete all such files and log each deletion. The corresponding Moodle resources (identified by the final filenames implied by the `.part` names) will be re-downloaded in the current run since they are not present in completed form in the state file.
- **Trigger**: Program startup, after output directory verification (REQ-ERR-009) and before any HTTP requests are made.
- **Input**:
  - The output directory path (and all subdirectories recursively).
  - All files within the output directory tree that have the `.part` file extension.
- **Output / Outcome**:
  - For each `.part` file found: log `Removing stale partial download: <absolute-path>` then delete the file.
  - If no `.part` files are found: no log entry is emitted for this step; startup continues silently.
  - After cleanup, the scrape proceeds as normal; resources whose `.part` files were deleted are not in the state file as completed, so they will be re-downloaded.
- **Error Conditions**:
  - A `.part` file cannot be deleted (e.g., EPERM): log "Warning: could not remove stale partial file <path>: <OS error>" and continue; the cleanup step does not abort the scrape.
  - The output directory is empty or does not contain any `.part` files: this is the normal case; no warning or error is emitted.
  - A `.part` entry is actually a directory (edge case): log "Warning: found .part directory (unexpected) at <path> — skipping." Do not attempt to delete a directory.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Stale .part files found on startup
    Given the output directory contains 2 .part files from a previous interrupted run
    When the scraper starts
    Then for each .part file a log entry is written matching "Removing stale partial download: <absolute-path>"
    And each .part file is deleted from disk
    And the scrape proceeds normally

  Scenario: No .part files found on startup
    Given the output directory contains no .part files
    When the scraper starts
    Then no "Removing stale partial download" log entries are emitted
    And the scrape proceeds normally

  Scenario: .part file cannot be deleted
    Given a .part file exists but is not deletable (permission denied)
    When the scraper attempts cleanup
    Then a warning is logged matching "Warning: could not remove stale partial file <path>: <OS error>"
    And the scrape continues regardless
    And other .part files (if any) are still cleaned up
  ```
- **Rules**:
  - RULE-ERR-013-A: The scan is recursive; all subdirectories of the output directory are included.
  - RULE-ERR-013-B: Only files with the exact extension `.part` are targeted; files with `.part` as a substring of a longer extension (e.g., `.partial`) are not affected.
  - RULE-ERR-013-C: The log message format for each deletion is exactly: `Removing stale partial download: <absolute-path>`.
  - RULE-ERR-013-D: Cleanup failure for a single `.part` file must not abort the startup sequence or the scrape.
  - RULE-ERR-013-E: Cleanup runs after output directory verification (REQ-ERR-009) and state file loading (REQ-ERR-010), but before any network requests.
- **Dependencies**: REQ-ERR-009 (output directory verification), REQ-ERR-010 (state file loading), REQ-FS-* (.part file naming convention), REQ-SYNC-* (state file — completed resources)

---

## Additional Requirements (from review)

### REQ-CLI-015: First-Run Setup Wizard
- **Type**: UX
- **Priority**: Must-Have
- **Description**: On the very first invocation of `moodle-scraper` (or `moodle-scraper scrape`) when no config file and no Keychain credentials exist, the program must enter an interactive setup wizard before doing anything else. The wizard walks through exactly four steps in order: (1) prompt for the Moodle base URL (e.g. `https://moodle.hwr-berlin.de`), validate it is HTTPS and reachable; (2) prompt for username (visible) and password (hidden), attempt login to verify; (3) prompt for output directory with default `./output/` shown; (4) print a summary of what was configured and confirm readiness. After the wizard completes successfully, the scrape begins immediately without requiring a second command. The wizard is skipped entirely if credentials and config already exist.
- **Trigger**: First invocation with no existing config file at `~/.config/moodle-scraper/config.json` AND no Keychain entry for service `moodle-scraper`.
- **Input**: Interactive terminal input: Moodle URL (string), username (string), password (hidden string), output directory path (string, Enter to accept default).
- **Output / Outcome**: Config file written to `~/.config/moodle-scraper/config.json` with `moodleUrl` and `outputDir`. Credentials stored in Keychain. Session cookies stored at `~/.config/moodle-scraper/session.json`. Scrape begins immediately after confirmation.
- **Error Conditions**:
  - Moodle URL is HTTP (not HTTPS): print "Error: URL must use HTTPS." and re-prompt. Maximum 3 attempts before aborting with exit code 1.
  - Moodle URL is unreachable (connection error or timeout): print "Error: could not reach <url> — check the URL and your internet connection." Re-prompt. Maximum 3 attempts.
  - Login fails (wrong password): print "Login failed: incorrect username or password." Re-prompt credentials. Maximum 3 attempts before aborting with exit code 2.
  - Output directory cannot be created (permission denied): print "Error: cannot create directory <path>: <reason>." Re-prompt directory. Maximum 3 attempts.
  - `--non-interactive` flag is set: skip wizard entirely; if config or credentials are missing, exit with code 2 and message "No configuration found. Run: moodle-scraper setup".
- **Acceptance Criteria**:
  ```gherkin
  Scenario: First-ever invocation completes setup and begins scrape
    Given no config file exists at ~/.config/moodle-scraper/config.json
    And no Keychain entry exists for service "moodle-scraper"
    When the user runs "moodle-scraper" and provides valid URL, credentials, and output dir
    Then config is written, credentials stored, and the scrape begins without any further command

  Scenario: Setup skipped when config and credentials already exist
    Given a valid config file exists and Keychain credentials are present
    When the user runs "moodle-scraper"
    Then the wizard is not shown and the incremental scrape begins immediately

  Scenario: Invalid HTTPS URL re-prompts up to 3 times
    Given no config exists
    When the user provides an HTTP URL three times in a row
    Then the program exits with code 1 and message "Setup aborted after 3 failed attempts."
  ```
- **Rules**:
  - RULE-CLI-015-A: The wizard must not require any flags or subcommands — plain `moodle-scraper` must trigger it on first run.
  - RULE-CLI-015-B: Wizard state is transactional: nothing is written to disk or Keychain until all four steps succeed. A failure mid-wizard leaves the system in its pre-wizard state.
  - RULE-CLI-015-C: The wizard is also accessible explicitly via `moodle-scraper setup` at any time, allowing re-configuration.
- **Dependencies**: REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-003, REQ-CLI-007

---

### REQ-CLI-016: Issues Detail View (`status --issues`)
- **Type**: UX
- **Priority**: Should-Have
- **Description**: The `status` command supports an `--issues` flag that prints a detailed, human-readable report of all known problems in the local sync state. The report is grouped into sections: (1) **Orphaned files** — local files whose Moodle resource no longer exists, listed by course with local path; (2) **Orphaned courses** — courses whose local folder exists but the user is no longer enrolled, listed with file count; (3) **Failed downloads** — resources that failed on the last scrape run and were skipped, listed with the failure reason; (4) **Stale partial files** — any `.part` files found in the output directory. Each section is printed only if it has at least one entry. If all sections are empty, print "No issues found." and exit 0.
- **Trigger**: User runs `moodle-scraper status --issues`.
- **Input**: Local state file (`.moodle-sync-state.json`), output directory tree scan (for `.part` files). No Moodle network request is made.
- **Output / Outcome**: Grouped plaintext report on stdout. Each issue line includes enough information to identify and manually resolve the issue. Exit code 0 always (issues are informational, not errors).
- **Error Conditions**:
  - State file missing: print "No state file found at <path>. Run 'moodle-scraper scrape' first." Exit 0.
  - State file corrupt: print "State file is corrupt — run 'moodle-scraper scrape' to rebuild it." Exit 0.
  - Output directory missing: print "Output directory <path> does not exist." Exit 0.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: State has orphaned files and a stale partial
    Given the state file contains 2 orphaned resources across 1 course
    And a .part file exists in the output directory
    When the user runs "moodle-scraper status --issues"
    Then stdout contains an "Orphaned files" section listing both resources with their local paths
    And stdout contains a "Stale partial files" section listing the .part file path
    And the exit code is 0

  Scenario: No issues exist
    Given the state file has no orphaned, failed, or partial entries
    And no .part files exist in the output directory
    When the user runs "moodle-scraper status --issues"
    Then stdout contains exactly "No issues found."
    And the exit code is 0
  ```
- **Rules**:
  - RULE-CLI-016-A: `status --issues` never makes any network request — it is entirely local.
  - RULE-CLI-016-B: The failed-downloads section requires that failed resources are recorded in the state file with a `status` of `"failed"` and a `failureReason` field (string). REQ-SYNC-001 must be updated to include this field.
  - RULE-CLI-016-C: Exit code is always 0 — the presence of issues is not an error condition for this command.
- **Dependencies**: REQ-CLI-006, REQ-SYNC-001, REQ-SYNC-005, REQ-SYNC-007

---

### REQ-SEC-009: Request Jitter and Browsing-Pattern Normalisation
- **Type**: Security
- **Priority**: Must-Have
- **Description**: To prevent the scraper's traffic from being identifiable as automated by Moodle's server-side monitoring, all outbound requests must exhibit human-like timing and header patterns. The fixed inter-request delay from REQ-SEC-005 is supplemented with a random jitter component. Additionally, standard browser request headers are included on all requests to make each request indistinguishable from normal browser activity at the HTTP header level, except for the User-Agent (which remains honest per REQ-SEC-006).
- **Trigger**: Every outbound HTTP request to the Moodle host.
- **Input**: The configured `requestDelayMs` base value; a cryptographically random jitter value; the list of standard headers to inject.
- **Output / Outcome**: Each request is sent after a delay of `requestDelayMs + random(0, requestDelayMs * 0.5)` milliseconds (i.e. jitter up to 50% of the base delay). Every request includes: `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`, `Accept-Language: de-DE,de;q=0.9,en;q=0.8` (reflecting HWR Berlin's German-language context), `Accept-Encoding: gzip, deflate, br`, `Referer: <url of the previously fetched Moodle page>` (set to the parent page URL for resource/file requests).
- **Error Conditions**:
  - Random number generator unavailable: fall back to fixed delay with no jitter and log a single WARN at startup "WARN: jitter unavailable — using fixed delay". Do not abort.
  - Referer URL for a request cannot be determined (e.g. first request of session): omit the Referer header for that request only.
- **Acceptance Criteria**:
  ```gherkin
  Scenario: Consecutive requests have varying delays
    Given requestDelayMs is set to 1000
    When 10 consecutive requests are made to the Moodle host
    Then no two consecutive inter-request delays are identical
    And every delay is between 1000 ms and 1500 ms inclusive

  Scenario: File download request includes Referer header
    Given the scraper is downloading a file from a course section page
    When the download request is sent
    Then the request includes a "Referer" header set to the course section page URL

  Scenario: Standard Accept headers are present on all requests
    Given any outbound request to the Moodle host
    When the request is inspected
    Then it includes "Accept", "Accept-Language", and "Accept-Encoding" headers with the specified values
  ```
- **Rules**:
  - RULE-SEC-009-A: Jitter is computed per-request using a uniform random distribution over `[0, requestDelayMs * 0.5]`, rounded to the nearest millisecond.
  - RULE-SEC-009-B: The `Accept-Language` header value is `de-DE,de;q=0.9,en;q=0.8` and is not configurable, as it reflects the expected language context of HWR Berlin's Moodle.
  - RULE-SEC-009-C: The `Referer` header is set to the URL of the Moodle page from which the current resource link was extracted (the "parent page"). It is never set to an external or non-Moodle URL.
  - RULE-SEC-009-D: No per-session or per-day download volume cap is enforced by the program itself (the rate limiting and jitter are sufficient); the user is responsible for not running force re-syncs of large course lists repeatedly in short succession.
- **Dependencies**: REQ-SEC-005, REQ-SEC-006

---

## Completeness Checklist

- [x] Every user interaction has a terminal state (success or handled error)
- [x] Every credential/auth scenario is specified
- [x] Every network failure scenario is specified
- [x] Every filesystem operation has format, path, and error handling
- [x] Incremental sync logic is fully specified
- [x] Session persistence / re-auth flow is fully specified
- [x] Output folder structure is fully specified
- [x] No requirement uses banned words (appropriate, reasonable, etc., TBD, as needed)
- [x] No open questions remain

## Requirement Count

| Category | Count |
|----------|-------|
| REQ-AUTH | 8 |
| REQ-SCRAPE | 12 |
| REQ-SYNC | 9 |
| REQ-FS | 8 |
| REQ-CLI | 16 |
| REQ-SEC | 9 |
| REQ-ERR | 13 |
| **Total** | **75** |

## State File Schema (canonical)

Each entry in `.moodle-sync-state.json` contains exactly:
```json
{
  "resourceId": "string (Moodle item ID)",
  "localPath": "string (relative, forward slashes)",
  "lastModified": "ISO8601 string or null",
  "contentHash": "64-char lowercase hex SHA-256 or null",
  "downloadedAt": "ISO8601 UTC string",
  "status": "ok | orphan | failed",
  "failureReason": "string or null (set when status=failed)"
}
```
