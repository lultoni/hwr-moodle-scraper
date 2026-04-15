# Persona 01: Lea

## Role

Lea is a first-semester Wirtschaftsinformatik student at HWR Berlin. She uses a MacBook Air (macOS Sonoma) and has never opened a terminal before today. A classmate showed her the project and she decided to try it after spending 40 minutes clicking through Moodle to download slides for one course. She wants offline copies of her lecture PDFs and slides so she can study on the S-Bahn without mobile data. She is motivated and careful but has no mental model for how a CLI tool works.

---

## Profile

| Field | Value |
|-------|-------|
| Name | Lea |
| Semester | 1st semester WI |
| OS | macOS Sonoma (MacBook Air M2) |
| Tech level | beginner — never used a terminal before |
| Enrolled courses | 12 (BWL, Mathematik, Informatik Grundlagen, Rechtliche Grundlagen, Buchführung, Wirtschaftsenglisch, Statistik, Projektmanagement Grundlagen, IT-Infrastruktur, Kommunikation, VWL, Studium Generale) |
| Usage history | first install today |
| State file condition | clean — no prior state |
| Keychain available | yes (macOS) |
| Primary motivation | download all course PDFs for offline studying on the S-Bahn |
| Main frustration | Moodle requires 40+ clicks to download all PDFs; keeps forgetting where things are |

---

## Workflow Trace

**1. Finding the tool and reading the README**

Her classmate texts her the GitHub link. She opens it in Safari. The README says "Node.js 20+ required". She does not know what Node.js is. She Googles "was ist Node.js" and then "how to install Node.js mac". She lands on nodejs.org and downloads the macOS installer. The installer finishes without errors. She does not know whether it worked.

```
(no terminal command yet — she hasn't opened one)
```

She notices the README says to open "Terminal". She searches Spotlight for "Terminal" and opens it. The blank prompt is disorienting. She types her name by accident and gets a "command not found" error.

**2. Installing the tool**

She pastes the install command from the README:

```
$ npm install -g hwr-moodle-scraper
```

```
> npm warn deprecated ...
> npm warn deprecated ...
> added 87 packages in 12s
```

Several deprecation warnings appear. She does not know if this means it failed. She reads the warnings three times. Eventually she tries the next step.

**3. Verifying the install**

```
$ msc --version
> 0.2.0
```

This works. She feels relieved but is unsure what `0.2.0` means.

**4. Running `msc scrape` for the first time — the wizard**

She types:

```
$ msc scrape
```

The first-run wizard starts. It asks for an output folder path. She does not know what an "absolute path" is. The prompt says something like `Output folder [/Users/lea/moodle-files]:`. She presses Enter to accept the default, not realising she could type anything. The folder name `moodle-files` is fine with her.

The wizard then asks for her Moodle username. She types her HWR student ID (e.g. `s12345`).

The wizard asks for her Moodle password. The input is masked (no characters shown). She types her password. She is not sure if it is working because nothing appears on screen. She types it again slowly.

The wizard confirms: "Credentials saved to macOS Keychain." She does not know what the Keychain is but this sounds reassuring.

**5. The first scrape — long silence**

The scrape begins. A progress bar appears showing course names and a file count. It moves, but slowly. After two minutes the progress bar appears to stall on one course. She waits. After eight minutes the bar finishes.

```
> Scraping 12 courses...
> [====================] 12/12 courses
> Done: 847 downloaded, 193 sidecars, 0 skipped.
```

She stares at the output. She does not know what "sidecars" means. She does not know what "skipped" means. She navigates to `~/moodle-files` in Finder.

**6. Exploring the output in Finder**

She sees a folder structure: `Semester_1/WI1234 BWL/` etc. She opens a course folder. Inside she sees:

- `.pdf` files — she recognises these, clicks them, they open in Preview. 
- `.md` files — she double-clicks one. TextEdit opens and shows raw Markdown text with `##` symbols and `**bold**` markup. She thinks something went wrong.
- `.url.txt` files — she double-clicks one. TextEdit opens showing a URL as plain text. She doesn't know how to open the link. She copies it manually into Safari.
- A `_Abschnittsbeschreibung.md` file — she finds this especially confusing, doesn't know what "Abschnitt" means in this context.

She messages her classmate: "the pdf files work but there are a lot of weird .md files everywhere, is that normal?"

**7. Running `msc status`**

Her classmate says "try msc status". She runs it:

```
$ msc status
```

```
> Courses: 12
> Files: 847 downloaded, 0 orphaned, 0 user-added
> Last sync: 2 minutes ago
```

She reads this. She understands "847 downloaded". She does not understand "orphaned" or "user-added". There is no explanation in the output.

**8. Running `msc tui`**

She tries `msc tui` because it sounds different from the other commands, and her classmate mentioned it.

```
$ msc tui
```

A full-screen menu appears with options: Scrape, Status, Config, Auth, Reset, Clean. She uses arrow keys and Enter. She finds this easier to navigate than the text commands. She explores "Status" and "Config" from the TUI. The Config screen shows key-value pairs she does not understand (`maxConcurrentDownloads`, `requestDelayMs`, etc.). She exits with `q`.

**9. Not running any advanced commands**

She does not try `--courses`, `--force`, `msc reset`, `msc clean`, or `msc auth`. These are not mentioned in any introduction she received and the command names are not self-explanatory to her. She assumes the tool "just works" after the first run.

**10. Second run (next day)**

She runs `msc scrape` again the next day to get any new files.

```
$ msc scrape
> Scraping 12 courses...
> [====================] 12/12 courses
> Done: 3 downloaded, 0 sidecars, 0 skipped.
> + Semester_1/WI1234 BWL/Kapitel 2/Folien Kapitel 2.pdf
> + Semester_1/WI5678 Mathe/Übungsblätter/Blatt 3.pdf
> ~ Semester_1/WI9012 Informatik/Allgemeines/Modulbeschreibung.md
```

She sees `+` and `~` prefixes but does not know what they mean. There is no legend in the output. She assumes the `+` files are new, which is correct, but she is guessing.

---

## Gap & Friction Log

| # | Step | Area | Observation | Severity |
|---|------|------|-------------|----------|
| 1 | 1 | install | README requires Node.js but gives no install guidance for macOS beginners — forces a Google detour | medium |
| 2 | 2 | install | npm deprecation warnings during install look like errors to a beginner — no reassurance that they are harmless | low |
| 3 | 5 | scrape | No explanation of what "sidecars" means in the "Done:" summary line | medium |
| 4 | 5 | scrape | During long first-run scrape, the progress bar stalls visually on slow courses — no indication of what is happening or estimated time remaining | medium |
| 5 | 6 | output | `.md` files open in TextEdit as raw Markdown — beginners expect readable content, not `##` and `**` syntax | high |
| 6 | 6 | output | `.url.txt` files cannot be double-clicked to open the URL — users must manually copy the URL into a browser | high |
| 7 | 6 | output | No README or index file in the output folder root explaining what the file types are and how to use them | medium |
| 8 | 7 | status | `msc status` output uses terms "orphaned" and "user-added" with no inline explanation | low |
| 9 | 8 | tui | TUI Config screen shows internal config keys (`maxConcurrentDownloads`, `requestDelayMs`) with no human-readable labels or descriptions | medium |
| 10 | 10 | scrape | Change report prefix symbols (`+`, `~`) have no legend in the output — users must guess their meaning | low |

---
