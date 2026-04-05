// REQ-CLI-002, REQ-CLI-008, REQ-CLI-009, REQ-CLI-010
import { validateOrRefreshSession } from "../auth/session.js";
import { fetchCourseList, fetchEnrolledCourses, fetchContentTree, fetchFolderFiles, type Course, type ContentTree, type Activity, type Section } from "../scraper/courses.js";
import { buildDownloadPlan } from "../scraper/dispatch.js";
import { buildCourseShortPaths } from "../scraper/course-naming.js";
import { getResourceId } from "../scraper/resource-id.js";
import { computeSyncPlan, SyncAction } from "../sync/incremental.js";
import { StateManager, migrateStatePaths, relocateFiles, type CourseState, type State } from "../sync/state.js";
import { KeychainAdapter } from "../auth/keychain.js";
import { createHttpClient } from "../http/client.js";
import { createLogger, LogLevel, type Logger } from "../logger.js";
import { ConfigManager } from "../config.js";
import { buildOutputPath, checkDiskSpace, atomicWrite } from "../fs/output.js";
import { sanitiseFilename } from "../fs/sanitise.js";
import { extractForumThreadUrls, extractPageContent } from "../scraper/forum.js";
import { extractAssignmentFeedback } from "../scraper/assign.js";
import { DownloadQueue, type DownloadItem } from "../scraper/downloader.js";
import { writeUrlFile } from "../scraper/content-types.js";
import { filterSidecars, type SidecarItem } from "../scraper/sidecar-filter.js";
import { EXIT_CODES } from "../exit-codes.js";
import { mkdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { writeFile } from "node:fs/promises";

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
  logger?: Logger;
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
  const level = quiet ? LogLevel.ERROR : verbose ? LogLevel.DEBUG : LogLevel.INFO;
  const logger = opts.logger ?? createLogger({ level, redact: [], logFile: logFileCfg ?? null });

  const httpClient = createHttpClient();
  const keychain = new KeychainAdapter();
  const stateManager = new StateManager(outputDir);

  // Auth — returns the session cookie for use in subsequent requests
  const sessionCookies = await validateOrRefreshSession({
    httpClient,
    keychain,
    baseUrl,
    ...(opts.logger ? { logger: opts.logger } : {}),
  });

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

  // Course list — prefer dashboard (all enrolled courses) over search query
  const courses: Course[] = opts.courses
    ? opts.courses.map((id) => ({ courseId: id, courseName: String(id), courseUrl: `${baseUrl}/course/view.php?id=${id}` }))
    : searchQuery
      ? await fetchCourseList({ baseUrl, sessionCookies, searchQuery })
      : await fetchEnrolledCourses({ baseUrl, sessionCookies });

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

  logger.debug("Fetching content trees…");

  // Content trees — fetch in parallel
  const trees: ContentTree[] = await Promise.all(
    courses.map(async (c) => {
      const tree = await fetchContentTree({ baseUrl, courseId: c.courseId, sessionCookies });
      return tree;
    })
  );

  // ── README.md + _Abschnittsbeschreibung.md ────────────────────────────────
  // These files are written OUTSIDE the sync-state system (no FileState entry,
  // no hash tracking). They are refreshed on every run from the live Moodle HTML,
  // so they stay current without user intervention.
  //
  // course README.md  → ContentTree.summary  (from extractCourseDescription)
  //   Written to: <outputDir>/<semesterDir?>/<courseDir>/README.md
  //   Source:     <div class="summary">, <div class="course-summary-section">,
  //               or <div class="summarytext"> (Moodle 4.x onetopic courses)
  //
  // _Abschnittsbeschreibung.md → Section.summary  (from parseContentTree summarytext)
  //   Written to: <outputDir>/.../<courseDir>/<sectionDir>/_Abschnittsbeschreibung.md
  //   Source:     <div class="summarytext"> inside each <li class="section">
  //   Moodle 4.x shows rich section descriptions (text, images, formatted HTML) here.
  //   Example: GPM "Herzlich Willkommen Jahrgang 2024!", RTG course intro text.
  //
  // DO NOT move these into the sync-state/download-plan flow. They are auxiliary
  // metadata files, not scraped Moodle resources, and must not appear in msc status
  // as "user files" or be deleted by msc reset.
  // Write course README.md files for courses that have a summary description
  const generatedFiles: string[] = [];
  if (!dryRun) {
    let TurndownServiceForDesc: typeof import("turndown") | undefined;
    for (const tree of trees) {
      if (!tree.summary) continue;
      if (!TurndownServiceForDesc) TurndownServiceForDesc = (await import("turndown")).default;
      const descMd = new TurndownServiceForDesc().turndown(tree.summary).trim();
      if (!descMd) continue;
      const sp = courseShortPaths.get(tree.courseId);
      const courseDirName = sanitiseFilename(sp?.shortName ?? courseNameMap.get(tree.courseId) ?? String(tree.courseId));
      const readmePath = join(outputDir, ...(sp?.semesterDir ? [sp.semesterDir] : []), courseDirName, "README.md");
      mkdirSync(dirname(readmePath), { recursive: true });
      await atomicWrite(readmePath, Buffer.from(descMd + "\n", "utf8"));
      generatedFiles.push(readmePath);
    }

    // Write section description files (_Abschnittsbeschreibung.md) for sections with summarytext
    for (const tree of trees) {
      const sp = courseShortPaths.get(tree.courseId);
      const courseDirName = sanitiseFilename(sp?.shortName ?? courseNameMap.get(tree.courseId) ?? String(tree.courseId));
      const courseDir = join(outputDir, ...(sp?.semesterDir ? [sp.semesterDir] : []), courseDirName);
      let TdSect: typeof import("turndown") | undefined;
      for (const section of tree.sections) {
        if (!section.summary) continue;
        if (!TdSect) TdSect = (await import("turndown")).default;
        const summaryMd = new TdSect().turndown(section.summary).trim();
        if (!summaryMd) continue;
        const sectionDirName = sanitiseFilename(section.sectionName);
        const summaryPath = join(courseDir, sectionDirName, "_Abschnittsbeschreibung.md");
        mkdirSync(dirname(summaryPath), { recursive: true });
        await atomicWrite(summaryPath, Buffer.from(summaryMd + "\n", "utf8"));
        generatedFiles.push(summaryPath);
      }
    }
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

          for (const activity of section.activities) {
            if (activity.activityType === "folder" && activity.url) {
              const entry = folderEntries.find((e) => e.activity === activity);
              if (!entry) continue;
              const { folderId, files, folderDescription } = entry;
              // Track duplicate folder names to produce distinct destPaths
              const prev = folderNameCount.get(activity.activityName) ?? 0;
              folderNameCount.set(activity.activityName, prev + 1);
              const nameSuffix = prev > 0 ? ` (${prev + 1})` : "";

              // If the folder has a description — either from activity-altcontent on the
              // course page (activity.description) or from the folder's own intro div
              // (folderDescription, extracted from <div id="intro"> on the folder page) —
              // preserve it as a label-md.  The course page often omits the intro div
              // entirely for folder activities, so folderDescription is the reliable source.
              const descHtml = activity.description ?? folderDescription;
              if (descHtml) {
                expandedActivities.push({
                  activityType: "label",
                  activityName: activity.activityName + nameSuffix,
                  url: "",
                  isAccessible: true,
                  resourceId: `folder-${folderId}-description`,
                  description: descHtml,
                });
              }

              for (const f of files) {
                // If this filename appears in multiple folders, put it in a subfolder named after the folder activity
                const collides = (fileNameFolderCount.get(f.name) ?? 0) > 1;
                expandedActivities.push({
                  activityType: "resource",
                  activityName: nameSuffix ? `${f.name}${nameSuffix}` : f.name,
                  url: f.url,
                  isAccessible: true,
                  resourceId: `folder-${folderId}-${f.name}`,
                  ...(collides ? { subDir: activity.activityName + nameSuffix } : {}),
                });
              }
            } else {
              expandedActivities.push(activity);
            }
          }
          return { ...section, activities: expandedActivities };
        })
      );
      // Per-course checkmark after full expansion
      const totalActivities = expandedSections.reduce((n, s) => n + s.activities.length, 0);
      const sp = courseShortPaths.get(tree.courseId);
      const displayName = sp?.shortName ?? (courseNameMap.get(tree.courseId) ?? String(tree.courseId));
      logger.info(`  ✓ ${displayName}  (${expandedSections.length} section(s), ${totalActivities} activity/activities)`);
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

  // Sync plan
  const plan = computeSyncPlan({ state, currentTree: expandedTrees, force, checkFiles, dryRun });

  // Promote SKIP → DOWNLOAD for entries that need re-processing:
  //   (a) info-md types (assign, feedback, etc.) — contain live personal data; always re-fetch
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
    // Get existing localPath from state
    const fileState = state.courses[courseIdStr]?.sections;
    let existingPath: string | undefined;
    for (const section of Object.values(fileState ?? {})) {
      const f = section.files?.[item.resourceId];
      if (f) { existingPath = f.localPath; break; }
    }
    const isInfoMd = INFO_MD_ACTIVITY_TYPES.has(activityType);
    const shouldBeMd = isInfoMd || PAGE_MD_ACTIVITY_TYPES.has(activityType) || activityType === "url";
    // (a) info-md: always re-fetch (live personal data)
    if (isInfoMd) { item.action = SyncAction.DOWNLOAD; continue; }
    // (b) md/url types with wrong extension in state
    if (shouldBeMd && existingPath && !existingPath.endsWith(".md") && !existingPath.endsWith(".url.txt")) {
      item.action = SyncAction.DOWNLOAD; continue;
    }
    // (c) binary types with no recognised extension in localPath (legacy ENAMETOOLONG / BUG-C)
    if (!shouldBeMd && existingPath) {
      const ext = extname(existingPath).toLowerCase();
      const hasDotInName = existingPath.includes(".");
      // Only promote if truly extensionless (not a dotfile like .DS_Store)
      if (ext === "" && hasDotInName === false) {
        item.action = SyncAction.DOWNLOAD; continue;
      }
      if (ext !== "" && !KNOWN_FILE_EXTS.has(ext) && !existingPath.endsWith(".url.txt") && !existingPath.endsWith(".description.md")) {
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

  const maxConcurrent = ((await config.get("maxConcurrentDownloads")) as number | undefined) ?? 3;
  const retryBaseDelayMs = ((await config.get("retryBaseDelayMs")) as number | undefined) ?? 5000;

  // Progress display: bar in normal mode, counter already embedded in log lines in verbose/debug mode
  const useProgressBar = !quiet && !verbose;
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

    const planItems = buildDownloadPlan([meta.activity], courseName, sectionName, outputDir, semesterDir);
    if (planItems.length === 0) {
      // Nothing to save (e.g. label with no description) — acknowledge so it's not re-planned
      logger.debug(`[SKIP-TYPE] ${courseName} / ${sectionName} / ${meta.activity.activityName} (${meta.activity.activityType} — nothing to save)`);
      acknowledgedItems.push(item);
      continue;
    }
    for (const planItem of planItems) {
      if (planItem.strategy === "binary") {
        logger.debug(`[DOWNLOAD] ${semesterDir ? semesterDir + "/" : ""}${courseName} / ${sectionName} / ${meta.activity.activityName}${counter}`);
        mkdirSync(dirname(planItem.destPath), { recursive: true });
        binaryItems.push({
          downloadItem: {
            url: planItem.url,
            destPath: planItem.destPath,
            sessionCookies,
            retryBaseDelayMs,
            onComplete: (fp) => { progress.bar?.increment(1, { file: basename(fp) }); },
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
  // consolidates short descriptions (≤60 chars) into per-dir _Beschreibungen.md files.
  let TurndownService: typeof import("turndown") | undefined;
  if (!TurndownService) TurndownService = (await import("turndown")).default;
  const sidecarFilterResult = filterSidecars(specialItems as SidecarItem[], TurndownService, logger);
  specialItems = sidecarFilterResult.filteredItems as typeof specialItems;
  const beschreibungenToWrite = sidecarFilterResult.beschreibungenFiles;
  const suppressedSidecarCount = sidecarFilterResult.suppressedCount;
  const consolidatedShortCount = sidecarFilterResult.consolidatedCount;

  // Write _Beschreibungen.md consolidation files (tracked via generatedFiles, not FileState)
  if (!dryRun) {
    for (const bf of beschreibungenToWrite) {
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
  for (let si = 0; si < specialItems.length; si++) {
    const { item, destPath, strategy, label, description, activityType } = specialItems[si]!;
    try {
      mkdirSync(dirname(destPath), { recursive: true });
      let content: string | undefined;
      if (strategy === "url-txt") {
        await writeUrlFile(destPath, item.url!);
        // url-txt: content is not buffered through atomicWrite, so specialItemHashes[si] stays "".
        // The file is still tracked via allDownloadedItems → FileState.localPath (no hash comparison).
      } else if (strategy === "page-md") {
        const { request } = await import("undici");
        const { body } = await request(item.url!, { headers: { cookie: sessionCookies } });
        const html = await body.text();
        if (!TurndownService) TurndownService = (await import("turndown")).default;
        const td = new TurndownService();

        if (activityType === "forum") {
          // Deep-dive: fetch each discussion thread and include content in the .md file
          const threads = extractForumThreadUrls(html, baseUrl);
          const sections: string[] = [`# ${label}`, ``];
          if (threads.length === 0) {
            sections.push(td.turndown(extractPageContent(html)));
          } else {
            const delayMs = ((await config.get("requestDelayMs")) as number | undefined) ?? 500;
            for (const thread of threads) {
              try {
                const { body: threadBody } = await request(thread.url, { headers: { cookie: sessionCookies } });
                const threadHtml = await threadBody.text();
                sections.push(`## [${thread.title}](${thread.url})`, ``, td.turndown(extractPageContent(threadHtml)), ``);
                if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
              } catch {
                sections.push(`## [${thread.title}](${thread.url})`, ``, `*(Konnte nicht geladen werden)*`, ``);
              }
            }
          }
          content = sections.join("\n");
        } else {
          content = td.turndown(extractPageContent(html));
        }
      } else if (strategy === "info-md") {
        if (!TurndownService) TurndownService = (await import("turndown")).default;
        const td = new TurndownService();
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
        if (activityType === "assign" && item.url) {
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
        if (!TurndownService) TurndownService = (await import("turndown")).default;
        content = new TurndownService().turndown(description ?? "");
      }
      if (content !== undefined) {
        const buf = Buffer.from(content, "utf8");
        const { hash } = await atomicWrite(destPath, buf);
        specialItemHashes[si] = hash;
      }
      if (specialItems[si]!.isSidecar) {
        sidecarCount++;
      } else {
        downloadedCount++;
        progress.bar?.increment(1, { file: label });
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

  const failedMsg = failedCount > 0 ? `, ${failedCount} failed` : "";
  const sidecarMsg = sidecarCount > 0 ? `, ${sidecarCount} sidecar${sidecarCount === 1 ? "" : "s"}` : "";
  logger.info(`Done: ${downloadedCount} downloaded${sidecarMsg}, ${skipped.length} skipped${failedMsg}.`);

  // Filter summary — shown whenever duplicates were suppressed or short descs consolidated
  const filterParts: string[] = [];
  if (suppressedSidecarCount > 0)
    filterParts.push(`${suppressedSidecarCount} duplicate sidecar${suppressedSidecarCount === 1 ? "" : "s"} suppressed`);
  if (consolidatedShortCount > 0) {
    const nFiles = beschreibungenToWrite.length;
    filterParts.push(`${consolidatedShortCount} short description${consolidatedShortCount === 1 ? "" : "s"} consolidated into ${nFiles} _Beschreibungen.md file${nFiles === 1 ? "" : "s"}`);
  }
  if (filterParts.length > 0) logger.info(`  ${filterParts.join(", ")}.`);

  // One-time hint to enable log file (only after a real download run, only once)
  const logHintShown = (await config.get("logHintShown")) as boolean | undefined;
  const currentLogFile = (await config.get("logFile")) as string | null | undefined;
  if (!currentLogFile && !logHintShown && downloadedCount > 0) {
    logger.info("Tip: Run `msc config set logFile ~/moodle-scraper.log` to keep a permanent log.");
    await config.set("logHintShown", true);
  }

  // Update state with downloaded files
  const updatedCourses: Record<string, CourseState> = { ...(state.courses as Record<string, CourseState>) };

  // Build sidecar map: resourceId → sidecar destPath (for description-md items)
  const sidecarPaths = new Map<string, string>();
  // Build submission paths map: resourceId → submission file paths (for assign items)
  const submissionPathsMap = new Map<string, string[]>();
  for (let i = 0; i < specialItems.length; i++) {
    const si = specialItems[i]!;
    if (si.strategy === "description-md") {
      sidecarPaths.set(si.item.resourceId ?? "", si.destPath);
    }
    const subPaths = specialItemSubmissionPaths[i];
    if (subPaths && subPaths.length > 0) {
      submissionPathsMap.set(si.item.resourceId ?? "", subPaths);
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
    files[resourceId] = {
      name: filenameFn(item.url ?? "", resourceId),
      url: item.url ?? "",
      localPath: destPath,
      // Prefer computed SHA-256; fall back to Moodle's data-hash token where available
      hash: computedHash || location?.hash || "",
      lastModified: new Date().toISOString(),
      status: "ok" as const,
      ...(sidecarPath ? { sidecarPath } : {}),
      ...(submissionPaths && submissionPaths.length > 0 ? { submissionPaths } : {}),
    };

    sections[sectionId] = { files };
    updatedCourses[courseIdStr] = { name: courseName, sections };
  }

  // Save state
  // Merge generatedFiles with existing state to preserve entries from previous runs
  // (e.g. a --courses partial run only writes some courses' README/section files).
  const existingGeneratedFiles = state.generatedFiles ?? [];
  const mergedGeneratedFiles = [...new Set([...existingGeneratedFiles, ...generatedFiles])];
  await stateManager.save({ courses: updatedCourses, generatedFiles: mergedGeneratedFiles });
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
