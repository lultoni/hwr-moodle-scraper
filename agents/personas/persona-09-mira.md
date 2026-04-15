## Role
Windows-native beginner — first-time installer, terminal-averse, no WSL.

## Profile

- **Semester**: 3rd
- **Major**: Wirtschaftsinformatik (WI)
- **OS**: Windows 11 native (no WSL, no Linux subsystem)
- **Tech level**: Beginner — opens CMD by default; does not know the difference between CMD and PowerShell; has never run a build tool
- **Moodle courses**: 13 enrolled
- **Usage history**: First install today (sent the GitHub link by a classmate)
- **Long-term state**: Clean — no prior state file, no output folder
- **Use pattern**: Wants to run it once, get the files, never open a terminal again if possible
- **Motivations**: Offline access to all course materials; hates clicking through Moodle's slow UI every time she needs a slide deck
- **Frustrations pre-tool**: Moodle is slow and disorganised; files are buried three clicks deep; she downloads PDFs one by one into a chaotic Downloads folder

## Workflow Trace

1. **Opens README.md on GitHub** — reads "Node.js 20+ required" and "npm install -g". Opens CMD (Start → type "cmd"). Types `node --version` — works, she has Node 20 from a class exercise.

2. **Tries `npm install -g moodle-scraper`** — npm ERR: 404. The package is not on the public npm registry. README doesn't say that. She tries again. Same error. Asks her friend over WhatsApp; friend says "you have to clone it first".

3. **Clones the repo, runs `npm run build` in CMD** — build succeeds. Then follows README instruction `sudo npm link` — CMD prints `'sudo' is not recognised as an internal or external command`. She is stuck.

4. **Friend tells her to open an Administrator CMD and run `npm link`** — she doesn't know how to open Administrator CMD. Googles it, finds a guide, succeeds. `msc` is now globally available.

5. **Opens PowerShell (not CMD), runs `msc scrape`** — first-run wizard starts. Wizard asks for output folder. She types `C:\Users\Mira\Documents\Moodle`. Wizard accepts the backslash path.

6. **Wizard prompts for Moodle username and password** — she enters them. Scrape runs. Files appear under `C:\Users\Mira\Documents\Moodle`. She is pleased.

7. **Closes PowerShell. Next day, opens PowerShell and runs `msc scrape` again** — wizard prompts for credentials again. She assumed they would be saved. Enters them again. Realises this will happen every single time.

8. **Runs `msc status`** — output shows file paths with forward slashes (e.g. `Semester_3/WI3042 Strategisches...`). She is used to backslashes on Windows. Mildly confusing but she can read it.

9. **Tries `msc tui`** — opens the default Windows Terminal (she pinned it after the install). Box-drawing characters render correctly in Windows Terminal. Then tries the same in old CMD — boxes are garbled (wrong code page, CP850 instead of UTF-8).

10. **Looks for a way to save her password** — searches README for "keychain", "password", "save credentials". Finds a macOS-specific note about Keychain. Nothing about Windows. Gives up and accepts re-prompting.

## Gap & Friction Log

| # | Step | Issue | Severity | Type |
|---|------|-------|----------|------|
| 1 | Install | README says `npm install -g moodle-scraper` but package is not on npm — no clarification that local build+link is required | High | Documentation |
| 2 | Install | `sudo npm link` instruction fails on Windows — `sudo` does not exist; correct Windows instruction is "open Administrator terminal, run `npm link`" | High | Documentation |
| 3 | Install | No Windows-native getting-started section in README; entire install path assumes Unix | High | Documentation |
| 4 | Credentials | No credential persistence on Windows native — keytar does not store to Windows Credential Manager by default; user re-prompted every run | High | Feature gap |
| 5 | Output | Path separators in `msc status` output are Unix-style forward slashes — confusing for Windows users expecting backslashes | Low | UX |
| 6 | TUI | Box-drawing characters render as garbage in old Windows CMD (CP850 code page) — only correct in Windows Terminal or PowerShell with UTF-8 set | Medium | Compatibility |
| 7 | Documentation | No note in README or `msc --help` about Windows CMD vs PowerShell vs Windows Terminal rendering differences | Medium | Documentation |
