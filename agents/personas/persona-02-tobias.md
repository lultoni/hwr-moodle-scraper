# Persona 02: Tobias

## Role

Tobias is a second-semester Wirtschaftsinformatik student at HWR Berlin. He runs Ubuntu 22.04 on a ThinkPad and is comfortable with terminals, bash scripts, and git. He installed the tool at the start of semester 1 and has been using it for three months. He has an existing state file with entries from semester 1 courses, some of which were restructured mid-semester and now have orphaned files. His main goal is to automate syncing with a cron job so he never has to think about it again — but the Linux credential situation is blocking him.

---

## Profile

| Field | Value |
|-------|-------|
| Name | Tobias |
| Semester | 2nd semester WI |
| OS | Ubuntu 22.04 LTS (ThinkPad X1) |
| Tech level | intermediate — comfortable with terminals, git, bash scripting |
| Enrolled courses | 14 (11 current semester + 3 still-visible sem 1 courses) |
| Usage history | 3 months (installed beginning of semester 1) |
| State file condition | has orphaned entries from a sem 1 course that was restructured |
| Keychain available | no (Linux — keytar not available) |
| Primary motivation | automate syncing via cron so files are always up to date without manual intervention |
| Main frustration | must re-enter password every time — breaks any attempt at automation |

---

## Workflow Trace

**1. Daily use — re-entering credentials every run**

Tobias runs `msc scrape` from his home directory:

```
$ msc scrape
```

```
> Moodle username: s23456
> Moodle password:
```

He is prompted for his username and password on every run because Linux has no keytar-backed keychain. He types them each time. After three months, this is a significant annoyance. He tried wrapping the command in a shell script with heredoc input, but the password prompt reads directly from `/dev/tty`, not stdin.

```bash
# His failed attempt at automation:
echo -e "s23456\nmypassword" | msc scrape
# Result: credentials prompt still appears on tty, script hangs
```

He gives up on stdin piping. He considers hardcoding the password in a shell script but knows this is a security problem.

**2. Investigating `msc auth status` on Linux**

```
$ msc auth status
```

```
> Credential storage: system keychain (keytar)
> Username: not set
> Password: not set
```

Wait — it says "system keychain (keytar)" but he thought keytar wasn't working. He checks:

```
$ msc auth set
> Moodle username: s23456
> Moodle password:
> Error: keytar native module not available on this platform. Credentials were not saved.
```

The `auth status` output is misleading: it shows "system keychain (keytar)" even on Linux where keytar is absent. The credentials are never stored. He now understands why he is re-prompted every run, but the `auth status` message is confusing.

**3. Looking for environment variable support**

Tobias knows that many CLI tools support env-var credential injection for automation (e.g. `GITHUB_TOKEN`, `POSTGRES_PASSWORD`). He checks the README and `msc --help` for env-var references:

```
$ msc --help
$ msc scrape --help
```

He finds no mention of `MSC_USERNAME`, `MSC_PASSWORD`, or any environment variable support. He checks `msc config list`:

```
$ msc config list
```

```
> outputDir: /home/tobias/moodle-files
> maxConcurrentDownloads: 5
> requestDelayMs: 500
> ...
```

No credential config keys. No env-var support. He is now stuck — there is no supported way to automate credential injection.

**4. Checking `msc status --issues` — finding orphaned files**

```
$ msc status --issues
```

```
> Orphaned files (3):
>   Semester_1/WI2345 Projektmanagement/Allgemeines/Kursplan_v1.pdf
>   Semester_1/WI2345 Projektmanagement/Allgemeines/Einführung_alt.md
>   Semester_1/WI2345 Projektmanagement/Woche 1/Folien alt.pdf
>
> User-added files (0):
>
> Tip: Run `msc clean` to remove user-added files.
```

He sees 3 orphaned files from a Projektmanagement course that was restructured in week 4 of sem 1. The files still exist on disk and in state but are no longer referenced by Moodle. He wants to clean them up.

He wonders: does `msc clean` handle orphaned files too, or only user-added files? He reads the `msc clean --help`:

```
$ msc clean --help
```

```
> Remove user-added files from the output directory.
> Options:
>   --move      Move to <outputDir>/User Files/ instead of deleting
>   --dry-run   Show what would be removed without removing
>   --force     Skip confirmation
```

`msc clean` handles "user-added files" only — not orphaned files. He must use `msc reset` to clean orphans, but `msc reset` resets all state and re-downloads everything, which takes 30+ minutes. There is no targeted orphan-cleanup command.

**5. Testing `--non-interactive` for cron use**

He reads about `--non-interactive` in the README and tries it:

```
$ msc scrape --non-interactive
```

```
> Error: No credentials found. Run `msc auth set` to configure credentials, or omit --non-interactive to be prompted.
```

On Linux, `msc auth set` doesn't persist credentials (keytar unavailable). So `--non-interactive` is effectively unusable on Linux — it requires stored credentials that can never be stored.

**6. Exploring whether `--dry-run` is useful for cron**

He tries dry-run to understand what would be synced:

```
$ msc scrape --dry-run
```

```
> Moodle username: s23456
> Moodle password:
> [dry-run] Would download 2 new files:
>   + Semester_2/WI3456 Statistik/Woche 5/Blatt 5.pdf
>   + Semester_2/WI3456 Statistik/Woche 5/Lösung 5.pdf
> [dry-run] No files were written.
```

Dry-run still prompts for credentials. He finds this useful for sanity-checking but it does not help his automation problem.

**7. Attempting a cron job with credential file workaround**

He writes a credentials config file approach as a workaround — storing his password in a file with `chmod 600` and sourcing it:

```bash
# ~/.msc-creds (chmod 600)
export MSC_USERNAME=s23456
export MSC_PASSWORD=mypassword
```

```bash
# crontab entry
0 8 * * * source ~/.msc-creds && msc scrape --non-interactive >> ~/msc-cron.log 2>&1
```

This does not work because env vars are not read by the tool, and `--non-interactive` still fails with "no credentials found". His cron job fails silently every morning.

**8. Checking `msc config get logFile`**

He tries to set up logging for the cron job:

```
$ msc config set logFile /home/tobias/msc.log
$ msc scrape -q
```

This works for quiet-mode scraping. The log file gets created. But without credential automation, he still cannot run this unattended.

**9. Manually scraping with `-q` for less noise**

As a partial workaround, he types his credentials once per session and runs:

```
$ msc scrape -q
```

```
> Moodle username: s23456
> Moodle password:
> Done: 5 downloaded, 0 skipped.
```

Quiet mode works well. The output is minimal. He accepts this as his workflow for now but remains frustrated.

---

## Gap & Friction Log

| # | Step | Area | Observation | Severity |
|---|------|------|-------------|----------|
| 1 | 1 | auth | Linux has no keytar support — credentials must be re-entered on every run | high |
| 2 | 2 | auth | `msc auth status` shows "system keychain (keytar)" even on Linux where keytar is unavailable — misleading | medium |
| 3 | 2 | auth | `msc auth set` silently fails on Linux — credentials appear to be saved but are not | high |
| 4 | 3 | auth | No env-var credential injection (`MSC_USERNAME` / `MSC_PASSWORD`) — no supported path to automation | high |
| 5 | 5 | scrape | `--non-interactive` fails on Linux because credentials can never be stored — the flag is effectively broken on Linux | high |
| 6 | 4 | status | Orphaned files have no targeted cleanup command — `msc clean` only targets user-added files, `msc reset` is a full wipe | medium |
| 7 | 4 | status | `msc status --issues` shows "Tip: Run `msc clean`..." even when zero user-added files exist and the actual issue is orphaned files | low |
| 8 | 7 | scrape | `--dry-run` still prompts for credentials — useful but inconsistent (user might expect dry-run to skip auth) | low |

---
