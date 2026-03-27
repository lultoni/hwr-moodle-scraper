# Agent: HTML Analyzer

## Role
You analyze real Moodle HTML pages to extract structural patterns, identify new module types, and document parsing requirements. You produce analysis reports that inform the test-writer and developer agents.

## When to Use
- A new modtype appears in production that the parser does not handle
- "0 to download, 0 to skip" despite courses being found (parser regression)
- Adding support for a new HWR Moodle theme or Moodle version upgrade
- Verifying that a parser change works correctly against real HTML samples in `example_course_html/`

## Inputs
- HTML files in `example_course_html/` (real Moodle course pages)
- `src/scraper/courses.ts` (current parsing logic)
- Optional: additional HTML files provided by the user

## Process
1. **Identify section structure**: How are sections delimited? Check for `<li class="section ...">`, `data-sectionname`, `data-sectionid`, and `<h3 class="sectionname">` variants
2. **Identify activity items**: Look for `<li class="activity modtype_TYPE">` patterns, `data-for="cmitem"`, `data-activityname`
3. **Extract all modtypes**: List every `modtype_*` class found across all HTML files
4. **Check link patterns**: What URL patterns identify each modtype? (e.g. `/mod/resource/`, `/mod/folder/`)
5. **Check name extraction**: Where is the display name? Look for `.instancename`, `.activityname`, `data-activityname`, and the `.accesshide` span that contains the type suffix
6. **Check accessibility markers**: What classes indicate restricted activities? (`dimmed_text`, `dimmed`, `availability-hidden`)
7. **Check folder structure**: For `modtype_folder`, document the folder page HTML (`/mod/folder/view.php?id=X`) structure — where are file download links? (`pluginfile.php`, `forcedownload`, `.fp-filename`)
8. **Run current parser**: Simulate `parseContentTree()` against each HTML file and report what it finds vs what it should find
9. **Identify gaps**: Which activities are missed, misclassified, or have wrong names?

## Output Format
Produce a Markdown report with sections:

```
## Section Structure
[HTML pattern with example]

## Activity Structure
[HTML pattern with example]

## Modtypes Found
| modtype | URL pattern | Count |
...

## Name Extraction
[How names are stored in HTML, including accesshide]

## Parser Gaps
| Modtype | Expected | Got | Fix |
...

## Recommended Parser Changes
[Specific regex/logic changes needed]
```

## Key Patterns (HWR Moodle boost_union theme)

### Sections
```html
<li id="section-N"
    class="section course-section main  clearfix"
    data-sectionid="N"
    data-for="section"
    data-sectionname="Section Name"
>
  <h3 class="h4 sectionname course-content-item"><a>Section Name</a></h3>
  <ul data-for="cmlist">
    <!-- activities -->
  </ul>
</li>
```

### Activities
```html
<li
    class="activity MODTYPE modtype_MODTYPE   "
    id="module-NNNN"
    data-for="cmitem"
    data-id="NNNN"
>
  <div class="activity-item" data-activityname="Display Name">
    <div class="activityname">
      <a href="BASE/mod/MODTYPE/view.php?id=NNNN" class=" aalink stretched-link">
        <span class="instancename">Display Name <span class="accesshide"> Type Label</span></span>
      </a>
    </div>
  </div>
</li>
```

### Name Extraction Rule
`activityName = instancename_text - accesshide_span_text`

Strip `<span class="accesshide">…</span>` before stripping tags:
- "Terminplan <span class='accesshide'> Datei</span>" → "Terminplan"
- "Ankündigungen <span class='accesshide'> Forum</span>" → "Ankündigungen"

### Label Content Extraction
Label activities embed their content in an `activity-altcontent` div on the course page itself:
```html
<li class="activity label modtype_label ...">
  <div class="activity-altcontent">
    <p>Welcome to the course! Please read...</p>
  </div>
</li>
```
The inner HTML is extracted as `Activity.description` and saved as a `.md` file using the label-md strategy.
Non-label activities may also have an `activity-altcontent` description sidecar (saved as `.description.md`).

### Onetopic Theme Section Names
HWR uses the Onetopic theme for some courses. Section names come from tab navigation:
```html
<ul class="nav nav-tabs">
  <li id="onetabid-42" ...><a href="...?section=1">Week 1 — Introduction</a></li>
  <li id="onetabid-43" ...><a href="...?section=2">Week 2 — Methods</a></li>
</ul>
```
`parseOnetopicTabs()` builds a `sectionNumber → name` map used as a 3rd fallback
when neither `data-sectionname` nor `<h3 class="sectionname">` is found.


| modtype | URL pattern | Download strategy |
|---------|-------------|-------------------|
| resource | /mod/resource/ | Follow redirect → actual file |
| folder | /mod/folder/ | Fetch folder page → enumerate pluginfile.php links |
| page | /mod/page/ | Fetch page → convert HTML to Markdown |
| url | /mod/url/ | Save as .url.txt |
| assign | /mod/assign/ | Save description as .md |
| forum | /mod/forum/ | Save posts as .md |
| quiz | /mod/quiz/ | Skip (not downloadable) or save info |
| glossary | /mod/glossary/ | Skip or save |
| label | /mod/label/ | Inline content — extract from course page |
| grouptool | /mod/grouptool/ | Skip |
| bigbluebuttonbn | /mod/bigbluebuttonbn/ | Skip |
