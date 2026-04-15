# Persona 03: Amara

## Role

Amara is a third-semester exchange student from France studying at HWR Berlin as part of an Erasmus programme. She uses a MacBook Pro (macOS Ventura). Her German is limited — she reads it slowly with the help of Google Translate and relies heavily on her English proficiency. She was recommended the tool by a German classmate who mentioned "it downloads everything from Moodle automatically." She is technically a beginner: she has used a terminal a handful of times but is not comfortable with it. HWR's Moodle interface is German-first, and navigating it manually is slow and stressful for her.

---

## Profile

| Field | Value |
|-------|-------|
| Name | Amara |
| Semester | 3rd semester (exchange, Erasmus) |
| OS | macOS Ventura (MacBook Pro Intel) |
| Tech level | beginner — has opened a terminal a few times but rarely |
| Enrolled courses | 8 (4 in German, 2 in English, 2 mixed — course names are German regardless) |
| Usage history | first install today |
| State file condition | clean — no prior state |
| Keychain available | yes (macOS) |
| Primary motivation | get all Moodle files organized offline without having to navigate the German Moodle UI constantly |
| Main frustration | Moodle interface is fully in German; she finds navigating it exhausting and slow |

---

## Workflow Trace

**1. Installing Node.js and the tool**

Her German classmate sends the GitHub link. She opens it and reads the README — it is in English, which she finds reassuring. She follows the install steps: downloads Node.js from nodejs.org, opens Terminal (she has used it before for a Python course), and runs:

```
$ npm install -g hwr-moodle-scraper
```

The install completes. She confirms it works:

```
$ msc --version
> 0.2.0
```

This goes smoothly. The English README helped.

**2. Running `msc scrape` — the wizard**

```
$ msc scrape
```

The first-run wizard starts in English. All prompts are in English. She appreciates this. The wizard asks:

1. Output folder path — she presses Enter to accept the default (`~/moodle-files`).
2. Moodle username — she enters her HWR student ID.
3. Moodle password — she types it. The masked input confuses her briefly, but she figures it out.

The wizard confirms: "Credentials saved to macOS Keychain." She doesn't know what the Keychain is but does not worry about it.

**3. The first scrape — output folder exploration**

The scrape completes in about seven minutes.

```
> Done: 634 downloaded, 89 sidecars, 0 skipped.
```

She opens Finder and navigates to `~/moodle-files`. She sees:

```
Semester_1/
  WI1234 Buchführung - Jahresabschluss/
  WI2345 Wirtschaftsenglisch/
  WI3456 IT-Grundlagen der Wirtschaftsinformatik/
  ...
Semester_3/
  WI5678 Internationales Management/
  WI6789 Supply Chain Management/
  ...
```

The top-level folders are named `Semester_1`, `Semester_3`. She is in her 3rd semester of the exchange programme but her courses include some mapped to semester 1 (prerequisites). The semester numbering makes sense once she thinks about it.

The course names are all in German (e.g. `WI1234 Buchführung - Jahresabschluss`), even for courses where some content is in English. This is because Moodle stores the course name in German. She expected this but is mildly disappointed — she cannot rename the folders without risking confusion with the tool's state.

**4. Exploring the output — German filenames and `.md` files**

Inside a course folder she sees:

- `Vorlesung_Woche1.pdf` — she can open this fine.
- `Einführung.md` — she double-clicks. TextEdit opens with raw Markdown. She sees `##` headers and `**bold**` and thinks the file is broken.
- `Hausaufgabe_Blatt1.url.txt` — she double-clicks. TextEdit opens with a URL. She does not know how to open the link from there. She copies it manually into Safari.
- `_Abschnittsbeschreibung.md` — she does not know what "Abschnittsbeschreibung" means. She Google-Translates it: "Section description." This makes sense. But the content inside is raw Markdown. She puts this aside.

She also notices filenames like `Übungsblatt.pdf` and `Prüfungsvorbereitung.md`. She recognizes the German words because her German is basic. But she worries that a classmate from a more distant language background would be completely lost.

**5. Running `msc status`**

```
$ msc status
```

```
> Courses: 8
> Files: 634 downloaded, 0 orphaned, 0 user-added
> Last sync: 4 minutes ago
```

The output is in English. She reads it and understands "634 downloaded." She does not understand "orphaned" — she looks it up. "Ah, files that are no longer in Moodle." She accepts this.

She asks herself: "What is '0 user-added'?" She assumes it means files she added herself. She has not added any files.

**6. Running `msc status --issues`**

```
$ msc status --issues
```

```
> Orphaned files (0):
> User-added files (0):
> No issues found.
```

This is clear and reassuring. She notes that both the summary command and the `--issues` variant are in English, which helps her.

**7. Understanding "Orphaned: 0"**

She is curious about the word "orphaned" in the status output. The term is English and she understands it literally ("a file without a parent"). In context she correctly infers it means "a file that was downloaded but is no longer on Moodle." She is satisfied with this understanding and moves on.

**8. Trying `msc tui`**

Her classmate mentioned the TUI. She runs:

```
$ msc tui
```

A full-screen menu appears in English. She navigates with arrow keys. She finds it intuitive. She explores the Status screen — same output as `msc status`. She explores Config — sees key names like `outputDir`, `maxConcurrentDownloads`. She does not change anything.

She finds the TUI friendlier than typing commands. She exits with `q`.

**9. Opening `.url.txt` files — realising they cannot be double-clicked**

She returns to a course folder and tries again to open `.url.txt` files. She right-clicks and sees "Open With" — all options are text editors. There is no browser option because the OS does not recognise `.url.txt` as a URL file type.

She runs:

```
$ cat ~/moodle-files/Semester_3/WI5678\ Internationales\ Management/Allgemeines/Kursseite.url.txt
```

```
> Name: Kursseite
> Description: Direktlink zur Kursseite
> URL: https://moodle.hwr-berlin.de/mod/url/view.php?id=12345
```

She now knows the URL. But the description ("Direktlink zur Kursseite") is in German. She understands it but notes that for a less advanced German reader, this would be confusing: the CLI output is in English but the file content is in German (because the content comes from Moodle which is German-first).

**10. Second scrape — incremental sync**

A week later she runs `msc scrape` again. It completes in under a minute.

```
> Done: 2 downloaded, 0 sidecars, 0 skipped.
> + Semester_3/WI5678 Internationales Management/Woche 2/Slides Week 2.pdf
> + Semester_3/WI6789 Supply Chain Management/Woche 2/Fallstudie.pdf
```

This works correctly. The change report shows new files. She understands the `+` prefix from context but notes there is no legend.

**11. Noticing that Moodle error messages appear in German**

During one scrape run, a network hiccup causes a Moodle login error. The CLI outputs:

```
> Error: Authentication failed. Moodle response: "Ungültige Anmeldedaten"
```

"Ungültige Anmeldedaten" is the raw German Moodle error message ("invalid credentials"). She can translate this but notes that a user unfamiliar with German would be confused. The CLI wraps the German string without translating or contextualizing it.

---

## Gap & Friction Log

| # | Step | Area | Observation | Severity |
|---|------|------|-------------|----------|
| 1 | 4 | output | `.md` files open in TextEdit as raw Markdown — not readable without a Markdown viewer | high |
| 2 | 4 | output | `.url.txt` files cannot be double-clicked to open URL — must be `cat`-ed and URL copied manually | high |
| 3 | 4 | output | Course names, section names, and file names are all in German because they come from Moodle — no renaming or translation support | low |
| 4 | 4 | output | `_Abschnittsbeschreibung.md` filename is in German — unclear to non-German speakers | low |
| 5 | 9 | output | `.url.txt` file content includes German description text from Moodle (e.g. "Direktlink zur Kursseite") — CLI is English but file content is German | low |
| 6 | 10 | scrape | Change report `+` prefix has no legend | low |
| 7 | 11 | scrape | Raw Moodle error messages in German are surfaced untranslated in CLI error output | medium |

---
