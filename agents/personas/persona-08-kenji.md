## Role
Kenji — 2nd semester WI student with a CS background, recently migrated from macOS to a Windows gaming PC running WSL2, encountering Linux/WSL-specific friction points the tool does not address.

## Profile
- **Semester**: 2
- **Major**: Wirtschaftsinformatik (WI)
- **OS**: Windows 11 with WSL2 (Ubuntu 22.04); previously used macOS
- **Tech level**: Developer — CS background from Japan, comfortable with terminals, shells, and package managers; familiar with WSL2 architecture and the Windows/Linux path duality
- **Moodle courses**: 14 enrolled
- **Usage history**: 3 weeks on WSL — recently migrated from macOS where he used `msc` for one semester; had to start from scratch (no cross-platform state transfer); familiar with the tool's overall behaviour
- **Long-term state**: Freshly migrated; no existing state on WSL; had a working setup on macOS with ~400 downloaded files but the state file was not transferred
- **Credentials**: No macOS Keychain in WSL — re-prompted for credentials on every `msc scrape` run; `msc auth set` stores nothing persistently
- **Use pattern**: Runs `msc scrape` at the start of each study week, sometimes `msc scrape --courses "keyword"` before specific lectures; accesses output files from both WSL and Windows apps (PDF reader, Obsidian on Windows side)
- **Motivations**: Reproduce his macOS workflow on Windows without losing the organised folder structure; access course files from both WSL Terminal and Windows native apps; avoid re-entering credentials every run
- **Frustrations pre-tool**: Had to manually download files from Moodle before each study session; appreciated the tool on macOS and wants the same experience on Windows

## Workflow Trace

1. **Installing `msc` on WSL**
   - What he tries: install the tool globally as documented.
   - Command: `npm install -g hwr-moodle-scraper` (or equivalent local build: `npm run build && npm install -g .`)
   - What he sees: On Ubuntu WSL the global npm prefix is owned by root, so a plain `npm install -g` fails with EACCES. He runs `sudo npm install -g .` instead.
   - Reaction: Works, but the README mentions only `npm install -g .` without noting that `sudo` is required on many Linux setups or that setting up a user-level npm prefix is the better long-term fix. He proceeds with `sudo` for now, aware it is not ideal.

2. **First run — credential prompt every time**
   - What he tries: run a full scrape.
   - Command: `msc scrape`
   - What he sees: Prompted for username and password. Enters credentials. Scrape runs successfully. On the next run, he is prompted again.
   - Reaction: Surprised — on macOS credentials were stored in Keychain and never re-prompted. Runs `msc auth status` to check.

3. **Checking auth status**
   - What he tries: understand why credentials are not persisted.
   - Command: `msc auth status`
   - What he sees: "No credentials stored." The output does not explain why — no mention of Keychain unavailability on Linux or what the fallback behaviour is.
   - Reaction: Confused. Tries `msc auth set`.

4. **Running `msc auth set`**
   - What he tries: explicitly store credentials so they persist.
   - Command: `msc auth set`
   - What he sees: Prompted for username and password. Enters them. "Credentials saved." — but on the next run, he is prompted again anyway. `msc auth status` still shows "No credentials stored."
   - Reaction: Frustrated. Realises that `msc auth set` silently fails on Linux because there is no Keychain backend. The "Credentials saved." confirmation message is misleading — nothing was actually persisted. He has to re-enter credentials on every run.

5. **Setting output to a Windows-native path**
   - What he tries: put the output folder on the Windows filesystem so he can access it from both WSL and Windows apps (Obsidian, SumatraPDF).
   - Command: `msc config set outputDir /mnt/c/Users/Kenji/Documents/moodle-output`
   - What he sees: Config saved. `msc scrape` runs and writes files to the Windows path via WSL. It works. Files are accessible from Windows Explorer.
   - Reaction: Satisfied that it works. But later, when the output path has a space (e.g. `/mnt/c/Users/Kenji/My Documents/moodle-output`), he finds that some internal shell invocations in the tool break because the path is not quoted.

6. **Opening a PDF from WSL Terminal**
   - What he tries: open a downloaded PDF directly from the Terminal after a scrape.
   - Command: `xdg-open "/mnt/c/Users/Kenji/Documents/moodle-output/Semester_2/Datenbanken/Vorlesung 1/slides.pdf"`
   - What he sees: Error — `xdg-open` is not configured in WSL and fails silently or with "No application found". He has to switch to Windows Explorer and navigate to the file manually.
   - Reaction: Minor friction. He knows to use `explorer.exe .` or `powershell.exe Start-Process` as workarounds, but wishes `msc` printed a Windows-compatible path in the Done summary so he could click or copy it.

7. **Paths in status output are WSL-style**
   - What he tries: look at `msc status --issues` output and copy a file path to open in a Windows app.
   - Command: `msc status --issues`
   - What he sees: All paths are WSL-style (`/mnt/c/Users/Kenji/...`). Windows apps (Obsidian, PDF readers) cannot use these paths directly — they need `C:\Users\Kenji\...` format.
   - Reaction: Has to manually convert paths. Wishes there was a config option to display paths in Windows format when running in WSL.

8. **Attempting to migrate macOS state to WSL**
   - What he tries: copy his old macOS state file to WSL to avoid re-downloading 400 files.
   - Action: copies `.moodle-scraper/state.json` from his macOS machine via AirDrop → USB → WSL. Edits the JSON to update the `outputDir` path from macOS format (`/Users/kenji/Documents/...`) to WSL format (`/mnt/c/Users/Kenji/...`).
   - What he sees: Manual path editing of a large JSON file. Runs `msc status` after — some entries resolve correctly, others do not (path case sensitivity differences between macOS APFS and Linux ext4 in WSL). Several files show as orphaned even though they exist on disk.
   - Reaction: Gets a partial migration working but it takes 45 minutes of manual work. There is no official migration path or tooling.

## Gap & Friction Log

| # | Step | Issue | Severity | Type |
|---|------|-------|----------|------|
| 1 | npm global install on Linux | `npm install -g` fails with EACCES on default Linux; requires `sudo` or npm prefix config; not documented | Medium | Documentation |
| 2 | Credential persistence on Linux/WSL | `keytar` has no backend on Linux WSL; credentials are re-prompted every run; `msc auth set` shows "Credentials saved" but nothing is persisted | High | Bug / UX |
| 3 | Misleading `msc auth set` confirmation | "Credentials saved." message is printed even when the keytar write silently fails on Linux; misleads user | High | Bug |
| 4 | No Linux credential fallback | On macOS, keytar writes to Keychain. On Linux, there is no fallback (no libsecret / GNOME Keyring integration, no encrypted file store); credentials are lost between runs | High | Feature Gap |
| 5 | Paths with spaces in outputDir | `outputDir` containing spaces may break internal path handling | Medium | Bug |
| 6 | WSL paths not Windows-friendly | Output paths are WSL-style (`/mnt/c/...`); Windows apps need `C:\...` format; no config to display Windows paths | Medium | UX |
| 7 | No cross-platform state migration | Moving from macOS to Linux/WSL requires manual JSON editing of state file; no migration tooling or documentation | Medium | Feature Gap |
| 8 | README lacks WSL setup guide | No section in README for WSL-specific setup (npm prefix, keytar limitations, path considerations) | Medium | Documentation |

## Feature Requests & Findings

**TICKET-1**
- Type: Bug
- Persona: Kenji
- Severity: High
- Description: `msc auth set` and `msc auth status` behave incorrectly on Linux/WSL. When `keytar` has no available backend (no Keychain, no libsecret, no GNOME Keyring), `keytar.setPassword()` silently fails or throws an error that is swallowed. The tool prints "Credentials saved." even though nothing was persisted. On the next run, the user is re-prompted. `msc auth status` returns "No credentials stored." immediately after a successful-looking `msc auth set`.
- Proposed resolution: (a) Detect `keytar` availability at startup. (b) If keytar is unavailable, print a clear diagnostic: "Credential storage (Keychain) is not available on this system. Credentials will be re-prompted each run. See `msc help credentials` for alternatives." (c) Never print "Credentials saved." if the write did not actually succeed. (d) In `msc auth status`, show the storage backend in use: "Backend: macOS Keychain" or "Backend: none (credentials not persisted)."
- Affected commands/flows: `msc auth set`, `msc auth status`, `msc scrape` credential prompt

**TICKET-2**
- Type: Feature Gap
- Persona: Kenji
- Severity: High
- Description: On Linux/WSL there is no persistent credential storage. Users must re-enter username and password on every `msc scrape` run. macOS users have Keychain, but Linux users have no alternative even though libsecret/GNOME Keyring is available on many Linux systems.
- Proposed resolution: Add libsecret as a second keytar backend. `keytar` already supports `libsecret` on Linux when the `libsecret-dev` package is installed. Document the installation step in the README Linux/WSL section. As a simpler alternative, add an encrypted credential file fallback (AES-256-GCM, key derived from machine-specific entropy) when neither Keychain nor libsecret is available. This is less secure than Keychain but vastly better than re-prompting every run.
- Affected commands/flows: `msc auth set`, `msc auth status`, `msc scrape`

**TICKET-3**
- Type: Bug
- Persona: Kenji
- Severity: Medium
- Description: When `outputDir` contains spaces (e.g. `/mnt/c/Users/Kenji/My Documents/moodle`), internal path operations may break due to unquoted string interpolation in shell-adjacent code paths (e.g. `checkDiskSpace` uses `df` with the path as an argument).
- Proposed resolution: Audit all uses of `outputDir` in shell invocations (`df`, `exec`, etc.) and ensure the path is always quoted or passed as an argument array rather than a string. Add a test case with a path containing spaces to prevent regression.
- Affected commands/flows: `msc scrape`, `msc config set outputDir`, `checkDiskSpace`

**TICKET-4**
- Type: UX Improvement
- Persona: Kenji
- Severity: Medium
- Description: All output paths displayed by `msc` (in status, done summary, change report) are in the native OS path format. On WSL, this is a POSIX path (`/mnt/c/...`). Windows applications require Windows-format paths (`C:\...`). Users who access files from both environments must manually convert paths.
- Proposed resolution: Add a `displayPathFormat` config key accepting `auto` (default), `posix`, or `windows`. When set to `windows` (or when auto-detected as WSL), convert paths in all user-facing output to Windows format using a simple `/mnt/c/` → `C:\` transformation. Print a note on first WSL detection: "WSL detected. Set `msc config set displayPathFormat windows` to show Windows-format paths."
- Affected commands/flows: `msc status`, `msc status --issues`, `msc scrape` Done summary and change report

**TICKET-5**
- Type: Feature Gap
- Persona: Kenji
- Severity: Medium
- Description: Migrating from macOS to Linux/WSL (or any platform change) requires manually editing the state JSON file to update all path strings. There is no official migration path, and path case sensitivity differences between APFS (case-insensitive) and ext4 (case-sensitive) cause partial failures even after manual editing.
- Proposed resolution: Add `msc state migrate --from-dir <old-path> --to-dir <new-path>` that rewrites all path strings in the state file from the old base path to the new base path, normalising case and separators. Add `--dry-run` to preview changes. Document the migration workflow in the README under "Moving to a New Machine."
- Affected commands/flows: new `msc state migrate` command, README

**TICKET-6**
- Type: Documentation
- Persona: Kenji
- Severity: Medium
- Description: The README has no WSL-specific setup section. Common WSL issues (npm global install permissions, keytar/libsecret unavailability, path format considerations, accessing output from Windows apps) are not addressed anywhere in the documentation.
- Proposed resolution: Add a "WSL / Linux Setup" section to the README covering: (a) recommended npm prefix setup to avoid `sudo`; (b) keytar/libsecret status and the re-prompt fallback; (c) setting `outputDir` to a `/mnt/c/...` path for Windows app access; (d) opening files from WSL using `explorer.exe` or `wslview`; (e) `displayPathFormat windows` config key.
- Affected commands/flows: README, `msc auth`, `msc config`
