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
