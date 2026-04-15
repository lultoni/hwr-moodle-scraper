## Role
iPad-first learner — uses the Mac only to scrape; does all studying and annotation on iPad via iCloud Drive.

## Profile

- **Semester**: 3rd
- **Major**: Wirtschaftsinformatik (WI)
- **OS**: macOS (primary scraping machine); iPad (primary study device)
- **Tech level**: Intermediate — comfortable with macOS, uses Terminal occasionally, understands file sync
- **Moodle courses**: 13 enrolled
- **Usage history**: 4 months (installed mid-semester 2)
- **Long-term state**: Output folder lives inside `~/Library/Mobile Documents/com~apple~CloudDocs/Moodle/` (iCloud Drive); PDFs sync automatically to iPad via Files app; she annotates PDFs in GoodNotes using Apple Pencil
- **Use pattern**: Runs `msc scrape` on her Mac before each study session; then switches to iPad, opens Files app, and imports new PDFs into GoodNotes
- **Motivations**: Seamless Mac-to-iPad workflow; Apple Pencil annotation of lecture slides; offline access during lectures and commute
- **Frustrations pre-tool**: Downloading individual PDFs from Moodle on iPad is painful (mobile Safari, multiple taps per file, no batch download); GoodNotes library was always incomplete

## Workflow Trace

1. **Runs `msc scrape` on Mac** — output syncs to iCloud Drive. 15 new PDFs appear in the Files app on her iPad. She is happy.

2. **Opens Files app on iPad** — sees a mix of `.pdf`, `.md`, `.url.txt`, and `.description.md` files alongside each PDF. The `.md` and `.url.txt` files are meaningless noise on iOS; she cannot open them usefully in Files app. They clutter the folder view.

3. **Imports a new PDF into GoodNotes** — works perfectly. She annotates it with Apple Pencil. The annotated copy now lives inside GoodNotes' internal library. The original file in the iCloud-synced output folder still exists unchanged.

4. **A lecture slide PDF is updated on Moodle one week later** — `msc scrape` detects the change (new hash), re-downloads, and overwrites the file in iCloud Drive. The iCloud copy is now the new version. Her GoodNotes annotations are on the OLD imported copy inside GoodNotes — not linked to the iCloud file. She has no warning this happened.

5. **Encounters a file with a long German name**: `Prüfungsleistung Moduleinheit _Strategisches Geschäftsprozessmanagement_.pdf` — in the GoodNotes file picker (when importing), the filename is truncated to about 40 characters and she cannot tell which file it is. Same issue in the Files app file list.

6. **Tries to understand `.description.md` files** — taps one on iPad. Files app offers to open it in Pages (converts to a Pages document with raw Markdown syntax visible). She does not know what Markdown is. The file seems useless to her.

7. **Runs `msc status` from Mac** — sees file counts and paths. Cannot tell from the CLI which files she has already annotated in GoodNotes (that information only exists inside GoodNotes).

8. **Wonders if there is a `--pdf-only` flag** — checks `msc scrape --help`. No such flag. Checks README. Not mentioned.

## Gap & Friction Log

| # | Step | Issue | Severity | Type |
|---|------|-------|----------|------|
| 1 | Browse | `.md`, `.url.txt`, and `.description.md` files appear alongside PDFs in iOS Files app — confusing noise for iPad users with no Markdown viewer | Medium | UX |
| 2 | GoodNotes workflow | When `msc scrape` re-downloads an updated PDF, it silently overwrites the iCloud file; GoodNotes annotations are on the old imported copy; no warning is given | High | UX / Data safety |
| 3 | File naming | Long German course/file names (>40 chars) are truncated in the GoodNotes file picker and iOS Files app name display, making files hard to identify | Low | UX |
| 4 | Sidecar files | `.description.md` sidecar files are opaque to non-developer iPad users; no explanation in the file or in any accessible help text | Medium | Documentation / UX |
| 5 | Feature gap | No `--pdf-only` or `--skip-descriptions` flag to suppress non-binary output files in the synced folder | Medium | Feature gap |
