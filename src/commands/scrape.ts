// REQ-CLI-002, REQ-CLI-008, REQ-CLI-009, REQ-CLI-010
import { validateOrRefreshSession } from "../auth/session.js";
import { promptAndAuthenticate, type PromptFn } from "../auth/prompt.js";
import { fetchCourseList, fetchEnrolledCourses, fetchContentTree, fetchFolderFiles, type Course, type ContentTree, type Activity, type Section } from "../scraper/courses.js";
import { buildDownloadPlan, applyLabelSubfolders } from "../scraper/dispatch.js";
import { buildCourseShortPaths } from "../scraper/course-naming.js";
import { getResourceId } from "../scraper/resource-id.js";
import { computeSyncPlan, SyncAction } from "../sync/incremental.js";
import { StateManager, migrateStatePaths, relocateFiles, type CourseState, type State } from "../sync/state.js";
import { tryCreateKeychain } from "../auth/keychain.js";
import { createHttpClient } from "../http/client.js";
import { createLogger, LogLevel, type Logger } from "../logger.js";
import { ConfigManager } from "../config.js";
import { buildOutputPath, checkDiskSpace, checkDiskSpaceSafe, atomicWrite } from "../fs/output.js";
import { sanitiseFilename } from "../fs/sanitise.js";
import { extractForumThreadUrls, extractPageContent, extractEmbeddedVideoUrls } from "../scraper/forum.js";
import { extractAssignmentFeedback } from "../scraper/assign.js";
import { DownloadQueue, type DownloadItem } from "../scraper/downloader.js";
import { writeUrlFile, writeWeblocFile, writeWindowsUrlFile } from "../scraper/content-types.js";
import { filterSidecars, type SidecarItem } from "../scraper/sidecar-filter.js";
import { CourseProgressDisplay } from "../scraper/course-progress.js";
import { createTurndown } from "../scraper/turndown.js";
import { EXIT_CODES } from "../exit-codes.js";
import { registerShutdownHandlers } from "../process/shutdown.js";
import { isSameOrigin } from "../http/url-guard.js";
import { mkdirSync, renameSync, existsSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { platform } from "node:os";

// Change report colors — stdout TTY only, respects NO_COLOR
const CR_COLOR = process.stdout.isTTY && !process.env["NO_COLOR"];
const CR = {
  green:  CR_COLOR ? "\u001b[32m" : "",
  yellow: CR_COLOR ? "\u001b[33m" : "",
  reset:  CR_COLOR ? "\u001b[0m"  : "",
};

// --fast mode overrides
const FAST_REQUEST_DELAY_MS = 200;
const FAST_MAX_CONCURRENT = 8;

/** Escape markdown link special characters to prevent injection. */
function escapeMarkdownLink(text: string): string {
  return text.replace(/[[\]()]/g, "\\$&");
}

export interface ScrapeOptions {
  outputDir: string;
  dryRun: boolean;
  force: boolean;
  checkFiles?: boolean;
  /** Skip the minimum free disk space check. */
  skipDiskCheck?: boolean;
  /** Moodle base URL. Defaults to "https://moodle.hwr-berlin.de". */
  baseUrl?: string;
  nonInteractive?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  courses?: number[];
  metadata?: boolean;
  /** When true, skip description .md files and .url.txt — download binary/PDF files only. */
  noDescriptions?: boolean;
  /** Output machine-readable JSON summary to stdout instead of human-readable report. */
  json?: boolean;
  /** Speed-up mode: requestDelayMs=200, maxConcurrentDownloads=8 (heavier on server). */
  fast?: boolean;
  /** Prompt function for interactive credential entry (used as fallback when keychain unavailable). */
  promptFn?: PromptFn;
  logger?: Logger;
  /** Called at the start/end of slow waiting phases so callers (e.g. TUI) can show a spinner. */
  onPhase?: (event: "start" | "end", label: string) => void;
}

export async function runScrape(opts: ScrapeOptions): Promise<void> {
  const {
    outputDir,
    dryRun,
    force,
    checkFiles = false,
    baseUrl = "https://moodle.hwr-berlin.de",
    quiet = false,
    verbose = false,
    noDescriptions = false,
    json = false,
    fast = false,
  } = opts;

  // Guard: outputDir must be configured before we can proceed
  if (!outputDir) {
    throw Object.assign(
      new Error("outputDir is not configured. Run `msc` to set up, or use --output-dir <path>."),
      { exitCode: EXIT_CODES.USAGE_ERROR }
    );
  }

  // Config must be initialised before the logger so we can read logFile
  const config = new ConfigManager();
  const logFileCfg = (await config.get("logFile")) as string | null | undefined ?? null;
  // --json implies quiet for logger (suppress INFO to stderr)
  const effectiveQuiet = quiet || json;
  const level = effectiveQuiet ? LogLevel.ERROR : verbose ? LogLevel.DEBUG : LogLevel.INFO;
  const logger = opts.logger ?? createLogger({ level, redact: [], logFile: logFileCfg ?? null });

  // --fast: override request settings for faster scraping (heavier on server)
  if (fast) {
    if (dryRun) {
      logger.warn("Note: --fast has no effect in dry-run mode.");
    } else if (!effectiveQuiet) {
      logger.info(`[fast mode] requestDelayMs=${FAST_REQUEST_DELAY_MS}, maxConcurrentDownloads=${FAST_MAX_CONCURRENT}`);
    }
  }

  const httpClient = createHttpClient();
  const keychain = tryCreateKeychain();
  const stateManager = new StateManager(outputDir);

  // On non-macOS, inform the user that credentials won't be stored
  if (!keychain && !effectiveQuiet) {
    logger.info("Note: macOS Keychain not available — you'll be asked for credentials each run.");
  }

  // Auth — returns the session cookie for use in subsequent requests
  opts.onPhase?.("start", "Authenticating...");
  const sessionCookies = await validateOrRefreshSession({
    httpClient,
    keychain,
    baseUrl,
    // When keychain is unavailable (non-macOS), provide an interactive fallback
    // so the user can enter credentials instead of getting an auth error.
    ...(opts.promptFn ? {
      interactivePromptFallback: () =>
        promptAndAuthenticate({ promptFn: opts.promptFn!, httpClient, keychain, baseUrl, ...(opts.logger ? { logger: opts.logger } : {}) }),
    } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });

  // Register session cookies as secrets immediately to prevent leakage in subsequent log calls
  opts.onPhase?.("end", "Authenticating...");
  logger.addSecret(sessionCookies);

  // Register stored password in logger redact list so it cannot leak into logs
  if (keychain) {
    const creds = await keychain.readCredentials();
    if (creds?.password) logger.addSecret(creds.password);
  }

  // Disk space pre-check
  if (!opts.skipDiskCheck) {
    const minFreeMb = (await config.get("minFreeDiskMb")) as number | undefined ?? 1000;
    try {
      await checkDiskSpace(outputDir, { minFreeMb });
    } catch (err) {
      logger.info((err as Error).message);
      logger.info("  To override: msc scrape --skip-disk-check");
      throw err;
    }
  }

  // Course search query from config (e.g. "WI24A")
  const searchQuery = (await config.get("courseSearch")) as string | undefined;

  // Course list — fetch all enrolled courses first so real names (with WI#### codes) are available.
  // When --courses filter is set, we still need the real names for correct semester-folder mapping.
  opts.onPhase?.("start", "Fetching courses...");
  const allCourses: Course[] = searchQuery
    ? await fetchCourseList({ baseUrl, sessionCookies, searchQuery })
    : await fetchEnrolledCourses({ baseUrl, sessionCookies });
  const courses: Course[] = opts.courses
    ? opts.courses.map((id) => {
        const found = allCourses.find((c) => c.courseId === id);
        return found ?? { courseId: id, courseName: String(id), courseUrl: `${baseUrl}/course/view.php?id=${id}` };
      })
    : allCourses;
  opts.onPhase?.("end", "Fetching courses...");

  if (courses.length === 0) {
    if (searchQuery) {
      logger.info("No courses found matching the search query. Try: msc config set courseSearch <keyword>");
    } else {
      logger.info("No enrolled courses found on the Moodle dashboard. Make sure you are enrolled in at least one course.");
    }
    return;
  }

  logger.info(`Found ${courses.length} course(s).`);
  logger.info("");
  logger.info("Fetching course content...");
  logger.info("  (sec = sections, act = activities)");

  // Config values needed before the main download loop
  const retryBaseDelayMs = ((await config.get("retryBaseDelayMs")) as number | undefined) ?? 5000;

  // Build courseId → courseName lookup
  const courseNameMap = new Map<number, string>();
  for (const course of courses) {
    courseNameMap.set(course.courseId, course.courseName);
  }

  // Build courseId → { semesterDir, shortName } for organised folder structure
  const courseShortPaths = buildCourseShortPaths(courses);

  // Load state and auto-migrate any old-style localPaths to new short paths
  const rawState = await stateManager.load() ?? { courses: {} };
  const courseShortPathsStr = new Map<string, { semesterDir: string; shortName: string }>();
  for (const [id, sp] of courseShortPaths) courseShortPathsStr.set(String(id), sp);
  const { state: migratedState, changed: pathsChanged } = migrateStatePaths(rawState as State, outputDir, courseShortPathsStr);
  // Relocate files on disk if semesterDir has changed (e.g. skPlacement toggle)
  const { state, changed: relocateChanged } = relocateFiles(migratedState, outputDir, courseShortPathsStr);
  if (pathsChanged || relocateChanged) {
    await stateManager.save({ courses: state.courses, generatedFiles: state.generatedFiles });
    if (relocateChanged) logger.info("Moved files to updated folder layout.");
  }

  // One-time migration: rename legacy _Beschreibungen.md files to _Descriptions.md
  if (state.generatedFiles) {
    let migrationNeeded = false;
    const migratedGF = state.generatedFiles.map((p) => {
      if (!p.endsWith("_Beschreibungen.md")) return p;
      const newPath = p.slice(0, -"_Beschreibungen.md".length) + "_Descriptions.md";
      try {
        if (existsSync(p)) renameSync(p, newPath);
      } catch { /* best-effort */ }
      migrationNeeded = true;
      return newPath;
    });
    if (migrationNeeded) {
      state.generatedFiles = migratedGF;
      await stateManager.save({ courses: state.courses, generatedFiles: state.generatedFiles });
    }
  }

  // Mutable container for partial state — updated during downloads so SIGINT can save progress
  const generatedFiles: string[] = [];
  const partialState: { courses: Record<string, CourseState>; generatedFiles: string[] } = {
    courses: { ...(state.courses as Record<string, CourseState>) },
    generatedFiles: [...(state.generatedFiles ?? [])],
  };

  // Register SIGINT/SIGTERM handlers to save partial state + clean up .tmp files
  const shutdown = registerShutdownHandlers({
    stateManager,
    outputDir,
    getPartialState: () => ({
      courses: partialState.courses,
      generatedFiles: [...new Set([...partialState.generatedFiles, ...generatedFiles])],
    }),
  });

  logger.debug("Fetching content trees…");

  // Content trees — fetch with bounded concurrency to limit memory spikes
  const pLimitMod = await import("p-limit");
  const treeLimit = pLimitMod.default(5);
  opts.onPhase?.("start", "Fetching course content...");
  const trees: ContentTree[] = await Promise.all(
    courses.map((c) =>
      treeLimit(async () => {
        const tree = await fetchContentTree({ baseUrl, courseId: c.courseId, sessionCookies });
        return tree;
      })
    )
  );
  opts.onPhase?.("end", "Fetching course content...");

  // ── README.md + _SectionDescription.md ────────────────────────────────
  // These files are written OUTSIDE the sync-state system (no FileState entry,
  // no hash tracking). They are refreshed on every run from the live Moodle HTML,
  // so they stay current without user intervention.
  //
  // course README.md  → ContentTree.summary  (from extractCourseDescription)
  //   Written to: <outputDir>/<semesterDir?>/<courseDir>/README.md
  //   Source:     <div class="summary">, <div class="course-summary-section">,
  //               or <div class="summarytext"> (Moodle 4.x onetopic courses)
  //
  // _SectionDescription.md → Section.summary  (from parseContentTree summarytext)
  //   Written to: <outputDir>/.../<courseDir>/<sectionDir>/_SectionDescription.md
  //   Source:     <div class="summarytext"> inside each <li class="section">
  //   Moodle 4.x shows rich section descriptions (text, images, formatted HTML) here.
  //   Example: GPM "Herzlich Willkommen Jahrgang 2024!", RTG course intro text.
  //
  // DO NOT move these into the sync-state/download-plan flow. They are auxiliary
  // metadata files, not scraped Moodle resources, and must not appear in msc status
  // as "user files" or be deleted by msc reset.
  // Write course README.md files for courses that have a summary description
  // Track README content per course dir for dedup with section summaries
  const readmeContentByDir = new Map<string, string>();
  if (!dryRun) {
    for (const tree of trees) {
      if (!tree.summary) continue;
      const descMd = createTurndown().turndown(tree.summary).trim();
      if (!descMd) continue;
      const sp = courseShortPaths.get(tree.courseId);
      const courseDirName = sanitiseFilename(sp?.shortName ?? courseNameMap.get(tree.courseId) ?? String(tree.courseId));
      const courseDir = join(outputDir, ...(sp?.semesterDir ? [sp.semesterDir] : []), courseDirName);
      const readmePath = join(courseDir, "README.md");
      mkdirSync(dirname(readmePath), { recursive: true });
      await atomicWrite(readmePath, Buffer.from(descMd + "\n", "utf8"));
      generatedFiles.push(readmePath);
      readmeContentByDir.set(courseDir, descMd);
    }

    // Write section description files (_SectionDescription.md) for sections with summarytext
    if (!noDescriptions) {
    for (const tree of trees) {
      const sp = courseShortPaths.get(tree.courseId);
      const courseDirName = sanitiseFilename(sp?.shortName ?? courseNameMap.get(tree.courseId) ?? String(tree.courseId));
      const courseDir = join(outputDir, ...(sp?.semesterDir ? [sp.semesterDir] : []), courseDirName);
      for (const section of tree.sections) {
        if (!section.summary) continue;
        const summaryMd = createTurndown().turndown(section.summary).trim();
        if (!summaryMd) continue;
        // Skip summaries that contain only images/formatting with no meaningful text
        const textOnly = summaryMd.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[#*_\[\]()|\->\s]/g, "");
        if (!textOnly) continue;
        // Skip section summaries identical to the course README.md (common in onetopic courses)
        const readmeMd = readmeContentByDir.get(courseDir);
        if (readmeMd && summaryMd.trim() === readmeMd.trim()) continue;
        const sectionDirName = sanitiseFilename(section.sectionName);
        const summaryPath = join(courseDir, sectionDirName, "_SectionDescription.md");
        mkdirSync(dirname(summaryPath), { recursive: true });
        // Download embedded Moodle images and rewrite URLs to relative paths
        const { downloadEmbeddedImages } = await import("../scraper/images.js");
        const imgResult = await downloadEmbeddedImages(summaryMd, summaryPath, sessionCookies, retryBaseDelayMs, baseUrl);
        await atomicWrite(summaryPath, Buffer.from(imgResult.content + "\n", "utf8"));
        generatedFiles.push(summaryPath);
        for (const imgPath of imgResult.imagePaths) generatedFiles.push(imgPath);
      }
    }
    } // end if (!noDescriptions)
  } // end if (!dryRun) — course READMEs and section descriptions

  // Write _README.md to output root (UC-06/23) — refreshed each run, always current
  if (!dryRun) {
    const rootReadmePath = join(outputDir, "_README.md");
    mkdirSync(outputDir, { recursive: true });
    const rootReadmeContent = [
      `# HWR Moodle — Scraped Files`,
      ``,
      `This folder contains files downloaded from HWR Berlin's Moodle LMS by **msc** (HWR Moodle Scraper).`,
      ``,
      `## Folder Structure`,
      ``,
      `Files are organised as:`,
      `\`\`\``,
      `Semester_N/`,
      `  Course_Name/`,
      `    Section_Name/`,
      `      file.pdf          ← downloaded resource`,
      `      file.description.md  ← activity description`,
      `      link.url.txt      ← external link`,
      `      link.webloc       ← macOS shortcut (double-click to open)`,
      `      _SectionDescription.md  ← section summary`,
      `\`\`\``,
      ``,
      `## File Types`,
      ``,
      `| Extension | Description |`,
      `|-----------|-------------|`,
      `| \`.pdf\`, \`.docx\`, \`.zip\`, … | Downloaded course files |`,
      `| \`.md\` | Markdown text — open with any text editor or Markdown viewer |`,
      `| \`.url.txt\` | External link — contains the URL |`,
      `| \`.webloc\` | macOS URL shortcut — double-click to open in browser |`,
      `| \`.url\` | Windows URL shortcut — double-click to open in browser |`,
      ``,
      `## Your Own Files`,
      ``,
      `Place personal notes and files in a \`_User-Files/\` folder here. This folder is`,
      `never touched by \`msc\` — its contents are protected from cleanup operations.`,
      ``,
      `## Commands`,
      ``,
      `| Command | Description |`,
      `|---------|-------------|`,
      `| \`msc scrape\` | Download new and updated files |`,
      `| \`msc status\` | Show sync summary |`,
      `| \`msc status --changed\` | List files changed in the last run |`,
      `| \`msc status --issues\` | Check for missing files or old entries |`,
      `| \`msc clean\` | Remove personal files not managed by scraper |`,
      `| \`msc reset\` | Clear sync state (files kept) |`,
      ``,
    ].join("\n");
    try {
      await atomicWrite(rootReadmePath, Buffer.from(rootReadmeContent, "utf8"));
      generatedFiles.push(rootReadmePath);
    } catch { /* best-effort — don't fail scrape for README write error */ }
  }

  // Expand folders: replace folder activities with their contained files
  const expandedTrees: ContentTree[] = await Promise.all(
    trees.map(async (tree) => {
      const expandedSections: Section[] = await Promise.all(
        tree.sections.map(async (section) => {
          const expandedActivities: Activity[] = [];
          // Track folder names seen in this section to detect duplicates and deduplicate paths
          const folderNameCount = new Map<string, number>();

          // Pre-fetch all folder contents so we can detect cross-folder filename collisions
          type FolderEntry = { activity: Activity; folderId: string; files: Array<{ name: string; url: string }>; folderDescription?: string };
          const folderEntries: FolderEntry[] = [];
          for (const activity of section.activities) {
            if (activity.activityType === "folder" && activity.url) {
              const result = await fetchFolderFiles({ baseUrl, folderUrl: activity.url, sessionCookies });
              const folderIdMatch = /[?&]id=(\d+)/.exec(activity.url);
              const folderId = folderIdMatch ? folderIdMatch[1]! : activity.activityName;
              folderEntries.push({ activity, folderId, files: result.files, folderDescription: result.description });
              logger.debug(`  Expanding folder: ${activity.activityName} (${result.files.length} files)`);
            }
          }

          // Count how many folders each filename appears in (to detect collisions)
          const fileNameFolderCount = new Map<string, number>();
          for (const { files } of folderEntries) {
            const seen = new Set<string>();
            for (const f of files) {
              if (!seen.has(f.name)) {
                fileNameFolderCount.set(f.name, (fileNameFolderCount.get(f.name) ?? 0) + 1);
                seen.add(f.name);
              }
            }
          }

          // When >1 folder exists in a section, always place files in subfolders
          // named after the folder. When only 1 folder exists, keep flat layout to
          // avoid double nesting (e.g. Analysis/Musterklausuren/Musterklausuren/).
          const useSubDirs = folderEntries.length > 1;

          for (const activity of section.activities) {
            if (activity.activityType === "folder" && activity.url) {
              const entry = folderEntries.find((e) => e.activity === activity);
              if (!entry) continue;
              const { folderId, files, folderDescription } = entry;
              // Track duplicate folder names to produce distinct destPaths
              const prev = folderNameCount.get(activity.activityName) ?? 0;
              folderNameCount.set(activity.activityName, prev + 1);
              const nameSuffix = prev > 0 ? ` (${prev + 1})` : "";

              const folderSubDir = useSubDirs ? activity.activityName + nameSuffix : undefined;

              // If the folder has a description — either from activity-altcontent on the
              // course page (activity.description) or from the folder's own intro div
              // (folderDescription, extracted from <div id="intro"> on the folder page) —
              // preserve it as a label-md. When placed inside a subfolder, rename to
              // _FolderDescription.md for clarity.
              const descHtml = activity.description ?? folderDescription;
              if (descHtml) {
                expandedActivities.push({
                  activityType: "label",
                  activityName: folderSubDir ? "_FolderDescription" : activity.activityName + nameSuffix,
                  url: "",
                  isAccessible: true,
                  resourceId: `folder-${folderId}-description`,
                  description: descHtml,
                  ...(folderSubDir ? { subDir: folderSubDir } : {}),
                });
              }

              for (const f of files) {
                // If useSubDirs or filename collides across folders, put it in a subfolder
                const collides = (fileNameFolderCount.get(f.name) ?? 0) > 1;
                const fileSubDir = folderSubDir ?? (collides ? activity.activityName + nameSuffix : undefined);
                expandedActivities.push({
                  activityType: "resource",
                  activityName: nameSuffix ? `${f.name}${nameSuffix}` : f.name,
                  url: f.url,
                  isAccessible: true,
                  resourceId: `folder-${folderId}-${f.name}`,
                  ...(fileSubDir ? { subDir: fileSubDir } : {}),
                });
              }
            } else {
              expandedActivities.push(activity);
            }
          }
          return { ...section, activities: applyLabelSubfolders(expandedActivities) };
        })
      );
      // Per-course checkmark after full expansion
      const totalActivities = expandedSections.reduce((n, s) => n + s.activities.length, 0);
      const sp = courseShortPaths.get(tree.courseId);
      const displayName = sp?.shortName ?? (courseNameMap.get(tree.courseId) ?? String(tree.courseId));
      const MAX_NAME = 45;
      const truncated = displayName.length > MAX_NAME
        ? displayName.slice(0, MAX_NAME - 1) + "…"
        : displayName.padEnd(MAX_NAME);
      logger.info(`  ✓ ${truncated}  (${String(expandedSections.length).padStart(3)} sec, ${String(totalActivities).padStart(3)} act)`);
      return { ...tree, sections: expandedSections };
    })
  );

  // Build (courseId, sectionId) → sectionName lookup
  const sectionNameMap = new Map<string, string>();
  for (const tree of expandedTrees) {
    for (const section of tree.sections) {
      sectionNameMap.set(`${tree.courseId}:${section.sectionId}`, section.sectionName);
    }
  }

  // Build resourceId → { sectionId, hash } lookup for state saving
  const resourceSectionMap = new Map<string, { courseId: number; sectionId: string; hash: string }>();
  for (const tree of expandedTrees) {
    for (const section of tree.sections) {
      for (const activity of section.activities) {
        const resourceId = getResourceId(activity, tree.courseId, section.sectionId);
        resourceSectionMap.set(resourceId, { courseId: tree.courseId, sectionId: section.sectionId, hash: activity.hash ?? "" });
      }
    }
  }

  // Build set of resourceIds already in state (to distinguish new vs updated in change report)
  const existingResourceIds = new Set<string>();
  // Also build hash map to detect whether re-fetched content actually changed
  const previousHashes = new Map<string, string>();
  for (const course of Object.values(state.courses)) {
    for (const section of Object.values(course.sections ?? {})) {
      for (const [resourceId, fileState] of Object.entries(section.files ?? {})) {
        existingResourceIds.add(resourceId);
        if (fileState.hash) previousHashes.set(resourceId, fileState.hash);
      }
    }
  }

  // Sync plan
  const plan = computeSyncPlan({ state, currentTree: expandedTrees, force, checkFiles, dryRun });

  // Promote SKIP → DOWNLOAD for entries that need re-processing:
  //   (a) info-md types (assign, feedback, etc.) — contain live personal data; re-fetch if >24 h old
  //   (b) md/url-strategy types whose localPath lacks the expected extension (legacy mis-classification)
  //   (c) binary items whose localPath has no recognised file extension (ENAMETOOLONG/BUG-C legacy)
  const INFO_MD_ACTIVITY_TYPES = new Set(["assign","feedback","choice","vimp","hvp","h5pactivity","scorm","flashcard","survey","chat","lti","imscp","grouptool","bigbluebuttonbn","customcert","etherpadlite"]);
  const PAGE_MD_ACTIVITY_TYPES = new Set(["page","forum","quiz","glossary","book","lesson","wiki","workshop"]);
  const KNOWN_FILE_EXTS = new Set([".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".odt",".ods",".odp",".zip",".tar",".gz",".7z",".rar",".mp3",".mp4",".png",".jpg",".jpeg",".gif",".svg",".heic",".txt",".csv",".json",".xml",".html",".yml",".yaml",".java",".py",".js",".ts",".sql",".sh",".bin",".jar",".ipynb",".rtf",".conf",".md",".url.txt"]);
  for (const item of plan) {
    if (item.action !== SyncAction.SKIP || !item.resourceId || !item.courseId) continue;
    const courseIdStr = String(item.courseId);
    // Find the activity in the current tree to know its type
    let activityType: string | undefined;
    for (const tree of expandedTrees) {
      if (String(tree.courseId) !== courseIdStr) continue;
      for (const section of tree.sections) {
        const found = section.activities.find(
          (a) => getResourceId(a, tree.courseId, section.sectionId) === item.resourceId
        );
        if (found) { activityType = found.activityType; break; }
      }
      if (activityType) break;
    }
    if (!activityType) continue;
    // Get existing localPath and lastModified from state
    const courseSections = state.courses[courseIdStr]?.sections;
    let existingPath: string | undefined;
    let existingLastModified: string | undefined;
    for (const section of Object.values(courseSections ?? {})) {
      const f = section.files?.[item.resourceId];
      if (f) { existingPath = f.localPath; existingLastModified = f.lastModified; break; }
    }
    const isInfoMd = INFO_MD_ACTIVITY_TYPES.has(activityType);
    const shouldBeMd = isInfoMd || PAGE_MD_ACTIVITY_TYPES.has(activityType) || activityType === "url";
    // (a) info-md: re-fetch if older than 24 h (live personal data like grades/feedback)
    if (isInfoMd) {
      const staleMs = 24 * 60 * 60 * 1000;
      const age = existingLastModified ? Date.now() - new Date(existingLastModified).getTime() : Infinity;
      if (age >= staleMs) { item.action = SyncAction.DOWNLOAD; }
      continue;
    }
    // (b) md/url types with wrong extension in state
    if (shouldBeMd && existingPath && !existingPath.endsWith(".md") && !existingPath.endsWith(".url.txt")) {
      item.action = SyncAction.DOWNLOAD; continue;
    }
    // (c) binary types that are legacy ENAMETOOLONG / BUG-C artifacts:
    //   - truly extensionless paths (no dot at all — e.g. old "Dockerfile" with no ext)
    //   - numeric-only extension (e.g. ".1" from extname("FiMa 4.1") — BUG-C false extension)
    // NOT promoted: files with unusual-but-valid extensions like .base, .env, .conf, .lock, etc.
    if (!shouldBeMd && existingPath) {
      const ext = extname(existingPath).toLowerCase();
      if (ext === "" && !existingPath.includes(".")) {
        item.action = SyncAction.DOWNLOAD; continue;
      }
      if (/^\.\d+$/.test(ext)) {
        item.action = SyncAction.DOWNLOAD; continue;
      }
    }
  }

  const downloads = plan.filter((p) => p.action === SyncAction.DOWNLOAD);
  const skipped = plan.filter((p) => p.action === SyncAction.SKIP);

  logger.info("");
  logger.info("Syncing...");
  logger.info(`  ${downloads.length} new activit${downloads.length === 1 ? "y" : "ies"}, ${skipped.length} up to date.`);
  logger.info("");

  if (dryRun) {
    for (const item of plan) {
      logger.info(`[dry-run] ${item.action} ${item.resourceId ?? ""}`);
    }
    return;
  }

  logger.debug(`Sync plan: ${downloads.length} to download, ${skipped.length} to skip.`);

  // Log skipped items in verbose mode
  if (verbose) {
    for (const item of skipped) {
      const meta = activityMetaForItem(item, expandedTrees, courseNameMap, sectionNameMap);
      logger.debug(`[SKIP] ${meta.courseName} / ${meta.sectionName} / ${meta.filename} (already up to date)`);
    }
  }

  // Build a map from resourceId → Activity for dispatch
  const activityByResourceId = new Map<string, { activity: Activity; courseName: string; sectionName: string; semesterDir?: string }>();
  for (const tree of expandedTrees) {
    for (const section of tree.sections) {
      const sp = courseShortPaths.get(tree.courseId);
      const courseName = sp?.shortName ?? (courseNameMap.get(tree.courseId) ?? String(tree.courseId));
      const semesterDir = sp?.semesterDir;
      const sectionName = sectionNameMap.get(`${tree.courseId}:${section.sectionId}`) ?? "General";
      for (const activity of section.activities) {
        const resourceId = getResourceId(activity, tree.courseId, section.sectionId);
        activityByResourceId.set(resourceId, { activity, courseName, sectionName, ...(semesterDir ? { semesterDir } : {}) });
      }
    }
  }

  const maxConcurrent = fast ? FAST_MAX_CONCURRENT : (((await config.get("maxConcurrentDownloads")) as number | undefined) ?? 3);

  // Progress display: bar in normal mode, counter already embedded in log lines in verbose/debug mode
  const useProgressBar = !effectiveQuiet && !verbose;
  // Use a container so onComplete callbacks can reference bar after it's created
  const progress: { bar?: import("cli-progress").SingleBar } = {};

  // ── Download classification ────────────────────────────────────────────────
  // Downloads are split into three buckets:
  //
  //   binaryItems      – raw file downloads (strategy="binary"). Executed in
  //                      parallel via DownloadQueue with a progress bar.
  //
  //   specialItems     – non-binary content (page-md, info-md, label-md,
  //                      description-md, url-txt). Executed sequentially because
  //                      they may involve HTML fetching + Turndown conversion.
  //
  //   acknowledgedItems – activities that produce nothing on disk (e.g. a label
  //                       with no description, or a type with no saveable content).
  //                       Stored in state so the sync planner doesn't re-add them
  //                       on the next run.
  //
  // isSidecar flag (specialItems only):
  //   `description-md` items are SIDECAR files — `.description.md` companions
  //   written alongside the main activity file. They are generated from the
  //   activity's inline description HTML, not downloaded from Moodle.
  //   They are EXCLUDED from:
  //     - `totalItems` (verbose counter) — "(N/1173)" counts real activities
  //     - `downloadedCount` final summary — shown separately as ", 218 sidecars"
  //     - progress bar total — bar reflects files fetched from Moodle only
  //   They ARE included in:
  //     - `sidecarCount` — shown in final "Done:" line for transparency
  //     - FileState.sidecarPath — tracked so msc reset and msc status handle them
  //
  // Verbose counter format: " (N/totalItems)" appended to [DOWNLOAD] log lines.
  // Sidecar items log as "[SIDECAR] ..." without a counter (they have no position
  // in the activity list because they're generated, not planned from Moodle data).
  // Separate binary downloads from special-handling types
  const binaryItems: Array<{ downloadItem: DownloadItem; planItem: typeof downloads[0] }> = [];
  let specialItems: Array<{ item: typeof downloads[0]; destPath: string; strategy: string; label: string; description?: string; activityType?: string; isSidecar: boolean }> = [];
  // Items that are acknowledged but not downloadable (e.g. assign, forum, quiz) — save to state so they're not re-planned
  const acknowledgedItems: Array<typeof downloads[0]> = [];
  /** modtype → count of activities with that unknown type (for end-of-scrape summary) */
  const allUnknownTypes = new Map<string, number>();

  const totalItems = downloads.length;

  for (let i = 0; i < downloads.length; i++) {
    const item = downloads[i]!;
    if (!item.courseId) continue;
    // Labels have no URL — still process via activity meta
    if (!item.url && !item.resourceId) continue;

    const resourceId = item.resourceId ?? "";
    const meta = activityByResourceId.get(resourceId);
    const sp = item.courseId ? courseShortPaths.get(item.courseId) : undefined;
    const courseName = meta?.courseName ?? sp?.shortName ?? (item.courseId ? (courseNameMap.get(item.courseId) ?? String(item.courseId)) : "Unknown");
    const semesterDir = meta?.semesterDir ?? sp?.semesterDir;
    const sectionName = meta?.sectionName ?? "General";
    const counter = verbose ? ` (${i + 1}/${totalItems})` : "";

    if (!meta?.activity) {
      if (!item.url) {
        // No activity metadata and no URL — acknowledge so it's not re-planned every run
        acknowledgedItems.push(item);
        continue;
      }
      // Fallback: treat as binary download using URL-derived filename
      const urlPathname = new URL(item.url).pathname;
      const rawSegment = urlPathname.split("/").pop() ?? "";
      const filenameDerived = decodeURIComponent(rawSegment) || resourceId || "file";
      const destPath = await buildOutputPath({ outputDir, ...(semesterDir ? { semesterDir } : {}), courseName, sectionName, filename: filenameDerived });
      logger.debug(`[DOWNLOAD] ${semesterDir ? semesterDir + "/" : ""}${courseName} / ${sectionName} / ${filenameDerived}${counter}`);
      binaryItems.push({ downloadItem: { url: item.url, destPath, sessionCookies, retryBaseDelayMs }, planItem: item });
      continue;
    }

    const { items: planItems, unknownTypes: sectionUnknownTypes } = buildDownloadPlan([meta.activity], courseName, sectionName, outputDir, semesterDir);
    // Accumulate unknown types for end-of-scrape summary
    for (const [modtype, names] of sectionUnknownTypes) {
      for (const name of names) {
        logger.debug(`[UNKNOWN-TYPE] modtype="${modtype}" for "${name}" — treated as binary`);
      }
      const existing = allUnknownTypes.get(modtype) ?? 0;
      allUnknownTypes.set(modtype, existing + names.length);
    }
    if (planItems.length === 0) {
      // Nothing to save (e.g. label with no description) — acknowledge so it's not re-planned
      logger.debug(`[SKIP-TYPE] ${courseName} / ${sectionName} / ${meta.activity.activityName} (${meta.activity.activityType} — nothing to save)`);
      acknowledgedItems.push(item);
      continue;
    }
    for (const planItem of planItems) {
      if (noDescriptions && (planItem.strategy === "url-txt" || planItem.strategy === "description-md")) {
        acknowledgedItems.push(item);
        continue;
      }
      if (planItem.strategy === "binary") {
        logger.debug(`[DOWNLOAD] ${semesterDir ? semesterDir + "/" : ""}${courseName} / ${sectionName} / ${meta.activity.activityName}${counter}`);
        mkdirSync(dirname(planItem.destPath), { recursive: true });
        binaryItems.push({
          downloadItem: {
            url: planItem.url,
            destPath: planItem.destPath,
            sessionCookies,
            retryBaseDelayMs,
            onComplete: (fp) => {
              progress.bar?.increment(1, { file: basename(fp) });
              courseDisplay?.tick(item.courseId!, basename(fp));
            },
          },
          planItem: item,
        });
      } else {
        const strategyLabel = planItem.strategy === "info-md" ? "info-md" : planItem.strategy;
        const isSidecar = planItem.strategy === "description-md";
        if (isSidecar) {
          logger.debug(`[SIDECAR] ${semesterDir ? semesterDir + "/" : ""}${courseName} / ${sectionName} / ${meta.activity.activityName} (description-md)`);
        } else {
          logger.debug(`[DOWNLOAD] ${semesterDir ? semesterDir + "/" : ""}${courseName} / ${sectionName} / ${meta.activity.activityName} (${strategyLabel})${counter}`);
        }
        specialItems.push({
          item,
          destPath: planItem.destPath,
          strategy: planItem.strategy,
          label: meta.activity.activityName,
          activityType: meta.activity.activityType,
          isSidecar,
          ...(meta.activity.description ? { description: meta.activity.description } : {}),
        });
      }
    }
  }

  // ── Sidecar deduplication filter ──────────────────────────────────────────
  // Runs after classification, before any writes. Suppresses exact-duplicate sidecars and
  // consolidates short descriptions (≤60 chars) into per-dir _Descriptions.md files.
  const sidecarFilterResult = filterSidecars(specialItems as SidecarItem[], undefined, logger);
  specialItems = sidecarFilterResult.filteredItems as typeof specialItems;
  const descriptionsToWrite = sidecarFilterResult.descriptionsFiles;
  const suppressedSidecarCount = sidecarFilterResult.suppressedCount;
  const consolidatedShortCount = sidecarFilterResult.consolidatedCount;

  // Write _Descriptions.md consolidation files (tracked via generatedFiles, not FileState)
  if (!dryRun) {
    for (const bf of descriptionsToWrite) {
      mkdirSync(dirname(bf.path), { recursive: true });
      await atomicWrite(bf.path, Buffer.from(bf.content + "\n", "utf8"));
      generatedFiles.push(bf.path);
    }
  }

  if (useProgressBar && binaryItems.length > 0) {
    const cliProgress = await import("cli-progress");
    progress.bar = new cliProgress.SingleBar({
      format: "Downloading [{bar}] {percentage}% | {value}/{total} files | {file}",
      clearOnComplete: false,
      hideCursor: true,
    }, cliProgress.Presets.shades_classic);
    progress.bar.start(binaryItems.length + specialItems.filter((s) => !s.isSidecar).length, 0, { file: "" });
  }

  // Per-course mini progress display — active when TTY + useProgressBar
  // Replaces cli-progress bar when TTY is live (same gate, higher-resolution UI)
  const useCourseDisplay = useProgressBar && Boolean(process.stdout.isTTY);
  let courseDisplay: CourseProgressDisplay | undefined;
  if (useCourseDisplay) {
    // Compute per-course totals (binary + non-sidecar special items)
    const courseTotals = new Map<number, number>();
    for (const { planItem } of binaryItems) {
      if (planItem.courseId) courseTotals.set(planItem.courseId, (courseTotals.get(planItem.courseId) ?? 0) + 1);
    }
    for (const { item, isSidecar } of specialItems) {
      if (!isSidecar && item.courseId) courseTotals.set(item.courseId, (courseTotals.get(item.courseId) ?? 0) + 1);
    }
    // Build ordered course entries (follow courses array order)
    const courseEntries = courses
      .filter((c) => courseTotals.has(c.courseId))
      .map((c) => {
        const sp = courseShortPaths.get(c.courseId);
        const name = sp?.shortName ?? (courseNameMap.get(c.courseId) ?? String(c.courseId));
        return { courseId: c.courseId, name, total: courseTotals.get(c.courseId)! };
      });
    if (courseEntries.length > 0) {
      // Stop cli-progress bar if it was started — course display takes over
      if (progress.bar) {
        progress.bar.stop();
        progress.bar = undefined;
      }
      courseDisplay = new CourseProgressDisplay();
      courseDisplay.start(courseEntries);
    }
  }

  // Execute binary downloads via queue
  let downloadedCount = 0;
  let sidecarCount = 0;
  let failedCount = 0;
  // finalPaths[i] holds the actual on-disk path + hash for binaryItems[i]
  let binaryFinalPaths: Array<{ path: string; hash: string } | undefined> = [];

  if (binaryItems.length > 0) {
    const queue = new DownloadQueue({ maxConcurrent });
    const result = await queue.run(binaryItems.map((b) => b.downloadItem));
    downloadedCount += result.downloaded;
    failedCount += result.failed.length;
    binaryFinalPaths = result.finalPaths;

    for (const { item: failedItem, error } of result.failed) {
      logger.info(`  Warning: failed to download ${failedItem.url}: ${error.message}`);
    }

    // Periodic disk space check after binary downloads
    if (!opts.skipDiskCheck) {
      const minFreeMb = (await config.get("minFreeDiskMb")) as number | undefined ?? 1000;
      const diskOk = await checkDiskSpaceSafe(outputDir, { minFreeMb });
      if (!diskOk) {
        logger.warn("Warning: disk space is critically low after binary downloads.");
      }
    }
  }

  // ── Special-items execution ────────────────────────────────────────────────
  // Each item in specialItems is processed sequentially.
  //
  // Strategy dispatch:
  //   "url-txt"       → writes a plain-text .url.txt file with the URL
  //   "page-md"       → fetches the activity page, extracts <div role="main">
  //                     via extractPageContent(), converts with Turndown.
  //                     Forum special case: also iterates all discussion threads
  //                     (extractForumThreadUrls → per-thread fetch → per-thread
  //                     section in the .md). extractPageContent is CRITICAL here
  //                     — without it, the full 200 KB Moodle page HTML (nav, JS,
  //                     CSS, sidebar) goes into the .md file.
  //   "info-md"       → builds an info card: Type / URL / Description.
  //                     For assign: also fetches grade, Dozenten-Feedback, and
  //                     own submission file URLs from the assignment page.
  //   "label-md"      → converts activity-altcontent HTML to Markdown
  //   "description-md"→ same as label-md; written as a .description.md sidecar
  //                     alongside the main file (tracked via FileState.sidecarPath)
  //
  // Counter tracking:
  //   downloadedCount  incremented for all non-sidecar items that succeed
  //   sidecarCount     incremented for description-md items (isSidecar=true)
  //   failedCount      incremented on exception (warning logged; run continues)
  //   progress.bar     incremented only for non-sidecar items (bar total matches)
  // Execute special-type downloads sequentially
  // specialItemHashes[i] stores the SHA-256 hash of the written content for specialItems[i]
  const specialItemHashes: Array<string> = new Array(specialItems.length).fill("");
  // specialItemSubmissionPaths[i] stores any submission files downloaded for assign items
  const specialItemSubmissionPaths: Array<string[]> = specialItems.map(() => []);
  // specialItemImagePaths[i] stores any embedded image paths downloaded for page-md/label-md items
  const specialItemImagePaths: Array<string[]> = specialItems.map(() => []);
  // Dedup map: dir+contentHash → destPath for page-md/info-md items to suppress byte-identical files
  // (e.g. Moodle quiz that leaks another quiz's attempt data in the same course)
  const pageMdContentByDir = new Map<string, Set<string>>();
  for (let si = 0; si < specialItems.length; si++) {
    const { item, destPath, strategy, label, description, activityType } = specialItems[si]!;
    try {
      mkdirSync(dirname(destPath), { recursive: true });
      let content: string | undefined;
      if (strategy === "url-txt") {
        await writeUrlFile(destPath, item.url!, { name: label, description });
        // url-txt: content is not buffered through atomicWrite, so specialItemHashes[si] stays "".
        // The file is still tracked via allDownloadedItems → FileState.localPath (no hash comparison).
        // Also write a platform-native URL shortcut alongside the .url.txt file
        if (!dryRun) {
          const nativePath = destPath.replace(/\.url\.txt$/, platform() === "darwin" ? ".webloc" : platform() === "win32" ? ".url" : "");
          if (nativePath !== destPath) {
            try {
              if (platform() === "darwin") {
                writeWeblocFile(nativePath, item.url!);
              } else {
                writeWindowsUrlFile(nativePath, item.url!);
              }
              generatedFiles.push(nativePath);
            } catch { /* best-effort */ }
          }
        }
      } else if (strategy === "page-md") {
        // SSRF defense: validate URL is on the Moodle domain before fetching with session cookies
        if (!isSameOrigin(item.url!, baseUrl)) {
          logger.warn(`Skipping external URL: ${item.url}`);
          continue;
        }
        const { request } = await import("undici");
        const { body } = await request(item.url!, { headers: { cookie: sessionCookies } });
        const html = await body.text();
        const td = createTurndown();

        if (activityType === "forum") {
          // Deep-dive: fetch each discussion thread and include content in the .md file
          const threads = extractForumThreadUrls(html, baseUrl);
          const sections: string[] = [`# ${label}`, ``];
          if (threads.length === 0) {
            sections.push(td.turndown(extractPageContent(html)) + extractEmbeddedVideoUrls(html));
          } else {
            const delayMs = fast ? FAST_REQUEST_DELAY_MS : (((await config.get("requestDelayMs")) as number | undefined) ?? 500);
            for (const thread of threads) {
              try {
                // SSRF defense: skip forum threads pointing to external domains
                if (!isSameOrigin(thread.url, baseUrl)) {
                  sections.push(`## [${escapeMarkdownLink(thread.title)}](${thread.url})`, ``, `*(Externer Link — übersprungen)*`, ``);
                  continue;
                }
                const { body: threadBody } = await request(thread.url, { headers: { cookie: sessionCookies } });
                const threadHtml = await threadBody.text();
                sections.push(`## [${escapeMarkdownLink(thread.title)}](${thread.url})`, ``, td.turndown(extractPageContent(threadHtml)) + extractEmbeddedVideoUrls(threadHtml), ``);
                if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
              } catch {
                sections.push(`## [${escapeMarkdownLink(thread.title)}](${thread.url})`, ``, `*(Konnte nicht geladen werden)*`, ``);
              }
            }
          }
          content = sections.join("\n");
        } else {
          content = td.turndown(extractPageContent(html)) + extractEmbeddedVideoUrls(html);
        }
        // Moodle placeholder for empty books/pages — replace with description if available
        if (content.trim() === "In diesem Buch wurde bisher kein Inhalt eingefügt") {
          if (description) {
            content = td.turndown(description);
          } else {
            logger.debug(`[SKIP-PLACEHOLDER] ${label} — Moodle empty book placeholder`);
            content = undefined;
          }
        }
      } else if (strategy === "info-md") {
        const td = createTurndown();
        const descMd = description ? td.turndown(description) : "";
        const lines = [
          `# ${label}`,
          ``,
          `**Type:** ${activityType ?? "unknown"}`,
          `**URL:** ${item.url ?? ""}`,
        ];
        if (descMd) {
          lines.push(``, `## Description`, ``, descMd);
        }

        // For assignments: fetch the page to extract grade, feedback, and own submission files
        if (activityType === "assign" && item.url && isSameOrigin(item.url, baseUrl)) {
          try {
            const { request } = await import("undici");
            const { body: assignBody } = await request(item.url, { headers: { cookie: sessionCookies } });
            const assignHtml = await assignBody.text();
            const feedback = extractAssignmentFeedback(assignHtml, baseUrl);
            if (feedback) {
              if (feedback.grade) lines.push(``, `**Bewertung:** ${feedback.grade}`);
              if (feedback.feedbackHtml) {
                lines.push(``, `## Feedback des Dozenten`, ``, td.turndown(feedback.feedbackHtml));
              }
              if (feedback.submissionTextHtml) {
                lines.push(``, `## Eigene Einreichung (Online-Text)`, ``, td.turndown(feedback.submissionTextHtml));
              }
              if (feedback.submissionUrls.length > 0) {
                lines.push(``, `## Eigene Einreichung`);
                for (const subUrl of feedback.submissionUrls) {
                  // SSRF defense: skip submission URLs on external domains
                  if (!isSameOrigin(subUrl, baseUrl)) continue;
                  const fname = decodeURIComponent(subUrl.split("/").pop()?.split("?")[0] ?? "file");
                  // Download the submission file next to the .md file
                  const subDest = destPath.replace(/\.md$/, `.submission.${fname.includes(".") ? fname.split(".").pop() : "bin"}`);
                  try {
                    const { downloadFile } = await import("../scraper/downloader.js");
                    const { finalPath } = await downloadFile({ url: subUrl, destPath: subDest, sessionCookies, retryBaseDelayMs: 0 });
                    specialItemSubmissionPaths[si]!.push(finalPath);
                    lines.push(`- [${fname}](${finalPath})`);
                  } catch {
                    lines.push(`- [${fname}](${subUrl}) *(Download fehlgeschlagen)*`);
                  }
                }
              }
            }
          } catch {
            // If fetching the assignment page fails, fall through with basic info card
          }
        }

        lines.push(``);
        content = lines.join("\n");
      } else if (strategy === "label-md" || strategy === "description-md") {
        content = createTurndown().turndown(description ?? "");
        // Prepend an HTML comment origin header to sidecar files so the source
        // activity is identifiable when viewed as plain text (e.g. Apple Notes, TextEdit).
        if (strategy === "description-md" && content.trim()) {
          content = `<!-- Source: ${label} (${activityType ?? "unknown"}) -->\n\n${content}`;
        }
      }
      if (content !== undefined) {
        // Dedup: suppress page-md/info-md files whose content is byte-identical to another
        // file already written in the same directory (e.g. Moodle quiz that leaks another
        // quiz's attempt data, producing identical .md files)
        if (strategy === "page-md" || strategy === "info-md") {
          const { createHash } = await import("node:crypto");
          const contentHash = createHash("sha256").update(content).digest("hex");
          const dir = dirname(destPath);
          let dirSet = pageMdContentByDir.get(dir);
          if (!dirSet) { dirSet = new Set(); pageMdContentByDir.set(dir, dirSet); }
          if (dirSet.has(contentHash)) {
            logger.debug(`[SUPPRESS-DEDUP] ${label} — content identical to another file in ${dir}`);
            // Still count as downloaded (it was fetched), just skip writing
            if (specialItems[si]!.isSidecar) { sidecarCount++; } else { downloadedCount++; progress.bar?.increment(1, { file: label }); courseDisplay?.tick(item.courseId!, label); }
            continue;
          }
          dirSet.add(contentHash);
        }
        // Download embedded Moodle images and rewrite URLs to relative paths
        if (strategy !== "url-txt") {
          const { downloadEmbeddedImages } = await import("../scraper/images.js");
          const imgResult = await downloadEmbeddedImages(content, destPath, sessionCookies, retryBaseDelayMs, baseUrl);
          content = imgResult.content;
          specialItemImagePaths[si] = imgResult.imagePaths;
        }
        const buf = Buffer.from(content, "utf8");
        const writeResult = await atomicWrite(destPath, buf);
        if (writeResult.failed) {
          logger.warn(`  Warning: could not write ${destPath} — file may be locked by OneDrive/iCloud sync. Skipping.`);
          continue;
        }
        specialItemHashes[si] = writeResult.hash;
      }
      if (specialItems[si]!.isSidecar) {
        sidecarCount++;
      } else {
        downloadedCount++;
        progress.bar?.increment(1, { file: label });
        courseDisplay?.tick(item.courseId!, label);
      }
    } catch (err) {
      failedCount++;
      logger.info(`  Warning: failed to save ${item.url} — ${(err as Error).message}`);
    }
  }

  if (progress.bar) {
    progress.bar.stop();
    process.stdout.write("\n");
  }
  courseDisplay?.finish();

  // Build change report entries from completed downloads.
  // Only include a file as "~ updated" when its content hash actually changed — not just
  // because the activity was re-fetched (e.g. Moodle metadata touch with identical content).
  const changeEntries: Array<{ relativePath: string; isNew: boolean }> = [];
  for (let i = 0; i < binaryItems.length; i++) {
    const fp = binaryFinalPaths[i]?.path ?? binaryItems[i]!.downloadItem.destPath;
    const resourceId = binaryItems[i]!.planItem.resourceId ?? "";
    const isNew = !existingResourceIds.has(resourceId);
    const computedHash = binaryFinalPaths[i]?.hash ?? "";
    const prevHash = previousHashes.get(resourceId) ?? "";
    const contentChanged = isNew || !prevHash || computedHash !== prevHash;
    if (fp && contentChanged) changeEntries.push({ relativePath: relative(outputDir, fp), isNew });
  }
  for (let i = 0; i < specialItems.length; i++) {
    const si = specialItems[i]!;
    if (si.isSidecar) continue; // don't list sidecars in change report
    const resourceId = si.item.resourceId ?? "";
    const isNew = !existingResourceIds.has(resourceId);
    const computedHash = specialItemHashes[i] ?? "";
    const prevHash = previousHashes.get(resourceId) ?? "";
    const contentChanged = isNew || !prevHash || computedHash !== prevHash;
    if (si.destPath && contentChanged) changeEntries.push({ relativePath: relative(outputDir, si.destPath), isNew });
  }

  const failedMsg = failedCount > 0 ? `, ${failedCount} failed` : "";
  const submissionTotal = specialItemSubmissionPaths.reduce((n, arr) => n + arr.length, 0);
  const imageTotal = specialItemImagePaths.reduce((n, arr) => n + arr.length, 0);
  // Use the merged generated count (this run + previous runs) so the total matches what reset sees
  const mergedGeneratedCount = new Set([...(state.generatedFiles ?? []), ...generatedFiles]).size;
  const totalFiles = downloadedCount + sidecarCount + submissionTotal + imageTotal + mergedGeneratedCount;
  const skipMsg = skipped.length > 0 ? `${skipped.length} skipped` : "0 skipped";
  logger.info(`Done: ${totalFiles} files across ${courses.length} courses (${skipMsg}${failedMsg})`);
  const breakdownParts: string[] = [`${downloadedCount} activities`];
  if (sidecarCount > 0) breakdownParts.push(`${sidecarCount} description file${sidecarCount === 1 ? "" : "s"}`);
  if (submissionTotal > 0) breakdownParts.push(`${submissionTotal} submission${submissionTotal === 1 ? "" : "s"}`);
  if (imageTotal > 0) breakdownParts.push(`${imageTotal} image${imageTotal === 1 ? "" : "s"}`);
  if (mergedGeneratedCount > 0) breakdownParts.push(`${mergedGeneratedCount} generated`);
  logger.info(`  ${breakdownParts.join(", ")}`);

  // Filter summary — shown whenever duplicates were suppressed or short descs consolidated
  const filterParts: string[] = [];
  if (suppressedSidecarCount > 0)
    filterParts.push(`${suppressedSidecarCount} duplicate description file${suppressedSidecarCount === 1 ? "" : "s"} suppressed`);
  if (consolidatedShortCount > 0) {
    const nFiles = descriptionsToWrite.length;
    filterParts.push(`${consolidatedShortCount} short description${consolidatedShortCount === 1 ? "" : "s"} consolidated into ${nFiles} _Descriptions.md file${nFiles === 1 ? "" : "s"}`);
  }
  if (filterParts.length > 0) logger.info(`  ${filterParts.join(", ")}.`);

  // Change report — show new/updated files this run (skip on --quiet/--json, skip when nothing changed)
  if (!effectiveQuiet && changeEntries.length > 0) {
    const newCount = changeEntries.filter((e) => e.isNew).length;
    const updatedCount = changeEntries.length - newCount;
    const parts: string[] = [];
    if (newCount > 0) parts.push(`${newCount} new`);
    if (updatedCount > 0) parts.push(`${updatedCount} updated`);
    logger.info("");
    logger.info("Legend: + new  ~ updated");
    logger.info(`Changes this run: ${parts.join(", ")}`);
    // Sort by path for consistent output, cap at 30 lines to avoid flooding terminal
    const sorted = changeEntries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const maxLines = 30;
    const shown = sorted.slice(0, maxLines);
    for (const entry of shown) {
      const col = entry.isNew ? CR.green : CR.yellow;
      const sym = entry.isNew ? "+" : "~";
      process.stdout.write(`${col}  ${sym} ${entry.relativePath}${CR.reset}\n`);
    }
    if (sorted.length > maxLines) {
      logger.info(`  ... and ${sorted.length - maxLines} more`);
    }
  }

  // Unknown activity types summary
  if (!effectiveQuiet && allUnknownTypes.size > 0) {
    const totalUnknown = [...allUnknownTypes.values()].reduce((a, b) => a + b, 0);
    logger.info(`Note: ${totalUnknown} activit${totalUnknown === 1 ? "y" : "ies"} with unrecognised type${allUnknownTypes.size === 1 ? "" : "s"} (${[...allUnknownTypes.keys()].join(", ")}) downloaded as binary. Use --verbose for details.`);
  }

  // One-time hint to enable log file (only after a real download run, only once)
  const logHintShown = (await config.get("logHintShown")) as boolean | undefined;
  const currentLogFile = (await config.get("logFile")) as string | null | undefined;
  if (!currentLogFile && !logHintShown && downloadedCount > 0) {
    logger.info("Tip: Run `msc config set logFile ~/moodle-scraper.log` to keep a permanent log.");
    await config.set("logHintShown", true);
  }

  // ── _LastSync.md — persistent change record (UC-07) ──────────────────────
  // Written to output root after every (non-dry-run) scrape. Syncs to iCloud/
  // OneDrive automatically. `msc status --changed` reads lastSync from state.
  const newFiles = changeEntries.filter((e) => e.isNew).map((e) => e.relativePath);
  const updatedFiles = changeEntries.filter((e) => !e.isNew).map((e) => e.relativePath);
  if (!dryRun) {
    const nowIso = new Date().toISOString();
    const lastSyncLines: string[] = [
      `# Last Sync — ${nowIso.slice(0, 10)} ${nowIso.slice(11, 16)} UTC`,
      "",
      `Scrape completed: ${nowIso}`,
      `Courses: ${courses.length}`,
      `Total files: ${totalFiles}`,
      "",
    ];
    if (newFiles.length === 0 && updatedFiles.length === 0) {
      lastSyncLines.push("No changes this run.");
    } else {
      if (newFiles.length > 0) {
        lastSyncLines.push(`## New files (${newFiles.length})`, "");
        for (const f of newFiles) lastSyncLines.push(`+ ${f}`);
        lastSyncLines.push("");
      }
      if (updatedFiles.length > 0) {
        lastSyncLines.push(`## Updated files (${updatedFiles.length})`, "");
        for (const f of updatedFiles) lastSyncLines.push(`~ ${f}`);
        lastSyncLines.push("");
      }
    }
    const lastSyncPath = join(outputDir, "_LastSync.md");
    mkdirSync(outputDir, { recursive: true });
    await atomicWrite(lastSyncPath, Buffer.from(lastSyncLines.join("\n"), "utf8"));
    generatedFiles.push(lastSyncPath);
  }

  // Update state with downloaded files
  const updatedCourses: Record<string, CourseState> = { ...(state.courses as Record<string, CourseState>) };

  // Build sidecar map: resourceId → sidecar destPath (for description-md items)
  const sidecarPaths = new Map<string, string>();
  // Build submission paths map: resourceId → submission file paths (for assign items)
  const submissionPathsMap = new Map<string, string[]>();
  // Build image paths map: resourceId → embedded image file paths
  const imagePathsMap = new Map<string, string[]>();
  for (let i = 0; i < specialItems.length; i++) {
    const si = specialItems[i]!;
    if (si.strategy === "description-md") {
      sidecarPaths.set(si.item.resourceId ?? "", si.destPath);
    }
    const subPaths = specialItemSubmissionPaths[i];
    if (subPaths && subPaths.length > 0) {
      submissionPathsMap.set(si.item.resourceId ?? "", subPaths);
    }
    const imgPaths = specialItemImagePaths[i];
    if (imgPaths && imgPaths.length > 0) {
      imagePathsMap.set(si.item.resourceId ?? "", imgPaths);
    }
  }

  const allDownloadedItems = [
    ...binaryItems.map((b, i) => ({
      item: b.planItem,
      destPath: binaryFinalPaths[i]?.path ?? b.downloadItem.destPath,
      computedHash: binaryFinalPaths[i]?.hash ?? "",
    })),
    ...specialItems
      .map((si, i) => ({ si, origIdx: i }))
      .filter(({ si }) => si.strategy !== "description-md")  // sidecars share resourceId with parent — tracked via sidecarPath below
      .map(({ si, origIdx }) => ({ item: si.item, destPath: si.destPath, computedHash: specialItemHashes[origIdx] ?? "" })),
    // Acknowledged non-downloadable items (assign, forum, etc.) — save with empty localPath so they're not re-planned
    ...acknowledgedItems.map((item) => ({ item, destPath: "", computedHash: "" })),
  ];

  for (const { item, destPath, computedHash } of allDownloadedItems) {
    if (!item || !item.courseId) continue;

    const courseIdStr = String(item.courseId);
    const sp = courseShortPaths.get(item.courseId);
    const courseName = sp?.shortName ?? (courseNameMap.get(item.courseId) ?? String(item.courseId));
    const resourceId = item.resourceId ?? "";
    const location = resourceSectionMap.get(resourceId);
    const sectionId = location?.sectionId ?? "s0";

    const courseEntry = updatedCourses[courseIdStr] ?? { name: courseName, sections: {} };
    const sections = { ...(courseEntry.sections ?? {}) };
    const sectionEntry = sections[sectionId] ?? { files: {} };
    const files = { ...(sectionEntry.files ?? {}) };

    const sidecarPath = sidecarPaths.get(resourceId);
    const submissionPaths = submissionPathsMap.get(resourceId);
    const imagePaths = imagePathsMap.get(resourceId);
    files[resourceId] = {
      name: filenameFn(item.url ?? "", resourceId),
      url: item.url ?? "",
      localPath: destPath,
      // Prefer computed SHA-256; fall back to Moodle's data-hash token where available
      hash: computedHash || location?.hash || "",
      lastModified: new Date().toISOString(),
      status: "ok" as const,
      ...(destPath ? { downloadedAt: new Date().toISOString() } : {}),
      ...(sidecarPath ? { sidecarPath } : {}),
      ...(submissionPaths && submissionPaths.length > 0 ? { submissionPaths } : {}),
      ...(imagePaths && imagePaths.length > 0 ? { imagePaths } : {}),
    };

    sections[sectionId] = { files };
    updatedCourses[courseIdStr] = { name: courseName, sections };
    // Keep partial state in sync for SIGINT handler
    partialState.courses = updatedCourses;
  }

  // Mark orphaned resources in state (e.g. resourceId changed due to name sanitisation fix)
  const orphanItems = plan.filter((p) => p.action === SyncAction.ORPHAN);
  for (const item of orphanItems) {
    if (!item.resourceId) continue;
    // Find the orphan in updatedCourses and mark it
    for (const courseEntry of Object.values(updatedCourses)) {
      for (const sectionEntry of Object.values(courseEntry.sections ?? {})) {
        const file = sectionEntry.files?.[item.resourceId];
        if (file) {
          file.status = "orphan";
          if (item.orphanReason) file.orphanReason = item.orphanReason;
          if (verbose) logger.debug(`[ORPHAN] ${item.resourceId}`);
        }
      }
    }
  }

  // Save state
  // Merge generatedFiles with existing state to preserve entries from previous runs
  // (e.g. a --courses partial run only writes some courses' README/section files).
  const existingGeneratedFiles = state.generatedFiles ?? [];
  const mergedGeneratedFiles = [...new Set([...existingGeneratedFiles, ...generatedFiles])];
  await stateManager.save({
    courses: updatedCourses,
    generatedFiles: mergedGeneratedFiles,
    lastSync: { timestamp: new Date().toISOString(), newFiles, updatedFiles },
  });

  // Run postScrapeHook if configured and there were changes (UC-35)
  const hookCmd = (await config.get("postScrapeHook")) as string | null | undefined ?? null;
  if (hookCmd && changeEntries.length > 0) {
    const hookEnv: NodeJS.ProcessEnv = {
      ...process.env,
      MSC_NEW_COUNT: String(newFiles.length),
      MSC_UPDATED_COUNT: String(updatedFiles.length),
      MSC_CHANGED_FILES: [...newFiles, ...updatedFiles].join("\n"),
    };
    execFile("/bin/sh", ["-c", hookCmd], { env: hookEnv }, (err) => {
      if (err) {
        process.stderr.write(`[msc] postScrapeHook error: ${err.message}\n`);
      }
    });
  }

  // ── JSON summary output ────────────────────────────────────────────────────
  if (json) {
    const jsonResult = {
      newFiles: changeEntries.filter((e) => e.isNew).map((e) => e.relativePath),
      updatedFiles: changeEntries.filter((e) => !e.isNew).map((e) => e.relativePath),
      skipped: skipped.length,
      errors: failedCount > 0 ? [`${failedCount} download(s) failed`] : [] as string[],
    };
    process.stdout.write(JSON.stringify(jsonResult, null, 2) + "\n");
  }

  // Deregister shutdown handlers — scrape completed normally
  shutdown.unregister();
}

/** Get display metadata for a sync plan item (used for skip/download log messages). */
function activityMetaForItem(
  item: { resourceId?: string; courseId?: number; url?: string },
  trees: ContentTree[],
  courseNameMap: Map<number, string>,
  sectionNameMap: Map<string, string>,
): { courseName: string; sectionName: string; filename: string } {
  const courseName = item.courseId ? (courseNameMap.get(item.courseId) ?? String(item.courseId)) : "Unknown";
  const filename = item.url ? (decodeURIComponent(new URL(item.url).pathname.split("/").pop() ?? "") || item.resourceId || "file") : (item.resourceId ?? "file");
  // sectionName is best-effort; we don't have a direct resourceId→sectionId map here
  return { courseName, sectionName: "", filename };
}

/** Derive a filename from a URL, falling back to resourceId. */
function filenameFn(url: string, fallback: string): string {
  try {
    const urlPathname = new URL(url).pathname;
    const raw = urlPathname.split("/").pop() ?? "";
    return decodeURIComponent(raw) || fallback || "file";
  } catch {
    return fallback || "file";
  }
}
