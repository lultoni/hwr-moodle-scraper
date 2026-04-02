// REQ-CLI-002, REQ-CLI-008, REQ-CLI-009, REQ-CLI-010
import { validateOrRefreshSession } from "../auth/session.js";
import { fetchCourseList, fetchEnrolledCourses, fetchContentTree, fetchFolderFiles, type Course, type ContentTree, type Activity, type Section } from "../scraper/courses.js";
import { buildDownloadPlan } from "../scraper/dispatch.js";
import { buildCourseShortPaths, resolveSemesterDir } from "../scraper/course-naming.js";
import { getResourceId } from "../scraper/resource-id.js";
import { computeSyncPlan, SyncAction } from "../sync/incremental.js";
import { StateManager, migrateStatePaths, relocateFiles, type CourseState, type State } from "../sync/state.js";
import { KeychainAdapter } from "../auth/keychain.js";
import { createHttpClient } from "../http/client.js";
import { createLogger, LogLevel, type Logger } from "../logger.js";
import { ConfigManager } from "../config.js";
import { buildOutputPath } from "../fs/output.js";
import { DownloadQueue, type DownloadItem } from "../scraper/downloader.js";
import { writeUrlFile } from "../scraper/content-types.js";
import { mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { writeFile } from "node:fs/promises";

export interface ScrapeOptions {
  outputDir: string;
  dryRun: boolean;
  force: boolean;
  checkFiles?: boolean;
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

  const level = quiet ? LogLevel.ERROR : verbose ? LogLevel.DEBUG : LogLevel.INFO;
  const logger = opts.logger ?? createLogger({ level, redact: [], logFile: null });

  const httpClient = createHttpClient();
  const keychain = new KeychainAdapter();
  const config = new ConfigManager();
  const stateManager = new StateManager(outputDir);

  // Auth — returns the session cookie for use in subsequent requests
  const sessionCookies = await validateOrRefreshSession({
    httpClient,
    keychain,
    baseUrl,
    ...(opts.logger ? { logger: opts.logger } : {}),
  });

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

  // Build courseId → courseName lookup
  const courseNameMap = new Map<number, string>();
  for (const course of courses) {
    courseNameMap.set(course.courseId, course.courseName);
  }

  // Build courseId → { semesterDir, shortName } for organised folder structure
  const skPlacement = ((await config.get("skPlacement")) as "separate" | "in-semester" | undefined) ?? "separate";
  const skSemester = ((await config.get("skSemester")) as string | undefined) ?? "";
  const rawCourseShortPaths = buildCourseShortPaths(courses);
  // Apply SK placement resolution
  const courseShortPaths = new Map<number, { semesterDir: string; shortName: string }>();
  for (const [id, sp] of rawCourseShortPaths) {
    courseShortPaths.set(id, { ...sp, semesterDir: resolveSemesterDir(sp.semesterDir, skPlacement, skSemester) });
  }

  // Load state and auto-migrate any old-style localPaths to new short paths
  const rawState = await stateManager.load() ?? { courses: {} };
  const courseShortPathsStr = new Map<string, { semesterDir: string; shortName: string }>();
  for (const [id, sp] of courseShortPaths) courseShortPathsStr.set(String(id), sp);
  const { state: migratedState, changed: pathsChanged } = migrateStatePaths(rawState as State, outputDir, courseShortPathsStr);
  // Relocate files on disk if semesterDir has changed (e.g. skPlacement toggle)
  const { state, changed: relocateChanged } = relocateFiles(migratedState, outputDir, courseShortPathsStr);
  if (pathsChanged || relocateChanged) {
    await stateManager.save({ courses: state.courses });
    if (relocateChanged) logger.info("Moved files to updated folder layout.");
  }

  logger.debug("Fetching content trees…");

  // Content trees — fetch in parallel
  const trees: ContentTree[] = await Promise.all(
    courses.map(async (c) => {
      const tree = await fetchContentTree({ baseUrl, courseId: c.courseId, sessionCookies });
      const totalActivities = tree.sections.reduce((n, s) => n + s.activities.length, 0);
      logger.debug(`  ${c.courseName}: ${tree.sections.length} section(s), ${totalActivities} activity/activities`);
      return tree;
    })
  );

  // Expand folders: replace folder activities with their contained files
  const expandedTrees: ContentTree[] = await Promise.all(
    trees.map(async (tree) => {
      const expandedSections: Section[] = await Promise.all(
        tree.sections.map(async (section) => {
          const expandedActivities: Activity[] = [];
          // Track folder names seen in this section to detect duplicates and deduplicate paths
          const folderNameCount = new Map<string, number>();
          for (const activity of section.activities) {
            if (activity.activityType === "folder" && activity.url) {
              logger.debug(`  Expanding folder: ${activity.activityName}`);
              const files = await fetchFolderFiles({ baseUrl, folderUrl: activity.url, sessionCookies });
              // Use the activity URL's ?id= param as a stable unique key, falling back to name
              const folderIdMatch = /[?&]id=(\d+)/.exec(activity.url);
              const folderId = folderIdMatch ? folderIdMatch[1]! : activity.activityName;
              // Track duplicate folder names to produce distinct destPaths
              const prev = folderNameCount.get(activity.activityName) ?? 0;
              folderNameCount.set(activity.activityName, prev + 1);
              const nameSuffix = prev > 0 ? ` (${prev + 1})` : "";
              for (const f of files) {
                expandedActivities.push({
                  activityType: "resource",
                  activityName: nameSuffix ? `${f.name}${nameSuffix}` : f.name,
                  url: f.url,
                  isAccessible: true,
                  resourceId: `folder-${folderId}-${f.name}`,
                });
              }
              logger.debug(`    → ${files.length} file(s) in folder`);
            } else {
              expandedActivities.push(activity);
            }
          }
          return { ...section, activities: expandedActivities };
        })
      );
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

  const downloads = plan.filter((p) => p.action === SyncAction.DOWNLOAD);
  const skipped = plan.filter((p) => p.action === SyncAction.SKIP);

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

  // Separate binary downloads from special-handling types
  const binaryItems: Array<{ downloadItem: DownloadItem; planItem: typeof downloads[0] }> = [];
  const specialItems: Array<{ item: typeof downloads[0]; destPath: string; strategy: string; label: string; description?: string; activityType?: string }> = [];
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
        logger.debug(`[DOWNLOAD] ${semesterDir ? semesterDir + "/" : ""}${courseName} / ${sectionName} / ${meta.activity.activityName} (${strategyLabel})${counter}`);
        specialItems.push({
          item,
          destPath: planItem.destPath,
          strategy: planItem.strategy,
          label: meta.activity.activityName,
          activityType: meta.activity.activityType,
          ...(meta.activity.description ? { description: meta.activity.description } : {}),
        });
      }
    }
  }

  if (useProgressBar && binaryItems.length > 0) {
    const cliProgress = await import("cli-progress");
    progress.bar = new cliProgress.SingleBar({
      format: "Downloading [{bar}] {percentage}% | {value}/{total} files | {file}",
      clearOnComplete: false,
      hideCursor: true,
    }, cliProgress.Presets.shades_classic);
    progress.bar.start(binaryItems.length + specialItems.length, 0, { file: "" });
  }

  // Execute binary downloads via queue
  let downloadedCount = 0;
  let failedCount = 0;
  // finalPaths[i] holds the actual on-disk path (may have extension appended) for binaryItems[i]
  let binaryFinalPaths: Array<string | undefined> = [];

  if (binaryItems.length > 0) {
    const queue = new DownloadQueue({ maxConcurrent });
    const result = await queue.run(binaryItems.map((b) => b.downloadItem));
    downloadedCount += result.downloaded;
    failedCount += result.failed.length;
    binaryFinalPaths = result.finalPaths;

    for (const { item: failedItem, error } of result.failed) {
      logger.warn(`  Failed to download ${failedItem.url}: ${error.message}`);
    }
  }

  // Execute special-type downloads sequentially
  let TurndownService: typeof import("turndown") | undefined;
  for (const { item, destPath, strategy, label, description, activityType } of specialItems) {
    try {
      mkdirSync(dirname(destPath), { recursive: true });
      if (strategy === "url-txt") {
        await writeUrlFile(destPath, item.url!);
      } else if (strategy === "page-md") {
        const { request } = await import("undici");
        const { body } = await request(item.url!, { headers: { cookie: sessionCookies } });
        const html = await body.text();
        if (!TurndownService) TurndownService = (await import("turndown")).default;
        const td = new TurndownService();
        const md = td.turndown(html);
        await writeFile(destPath, md, { mode: 0o600 });
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
        lines.push(``);
        await writeFile(destPath, lines.join("\n"), { mode: 0o600 });
      } else if (strategy === "label-md" || strategy === "description-md") {
        if (!TurndownService) TurndownService = (await import("turndown")).default;
        const td = new TurndownService();
        const md = td.turndown(description ?? "");
        await writeFile(destPath, md, { mode: 0o600 });
      }
      downloadedCount++;
      progress.bar?.increment(1, { file: label });
    } catch (err) {
      failedCount++;
      logger.debug(`  Warning: failed to download ${item.url} — ${(err as Error).message}`);
    }
  }

  if (progress.bar) {
    progress.bar.stop();
    process.stdout.write("\n");
  }

  const failedMsg = failedCount > 0 ? `, ${failedCount} failed` : "";
  logger.info(`Done: ${downloadedCount} downloaded, ${skipped.length} skipped${failedMsg}.`);

  // Update state with downloaded files
  const updatedCourses: Record<string, CourseState> = { ...(state.courses as Record<string, CourseState>) };

  const allDownloadedItems = [
    ...binaryItems.map((b, i) => ({ item: b.planItem, destPath: binaryFinalPaths[i] ?? b.downloadItem.destPath })),
    ...specialItems
      .filter((si) => si.strategy !== "description-md")  // sidecars share resourceId with parent — skip to avoid overwriting parent's localPath
      .map((si) => ({ item: si.item, destPath: si.destPath })),
    // Acknowledged non-downloadable items (assign, forum, etc.) — save with empty localPath so they're not re-planned
    ...acknowledgedItems.map((item) => ({ item, destPath: "" })),
  ];

  for (const { item, destPath } of allDownloadedItems) {
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

    files[resourceId] = {
      name: filenameFn(item.url ?? "", resourceId),
      url: item.url ?? "",
      localPath: destPath,
      hash: location?.hash ?? "",
      lastModified: new Date().toISOString(),
      status: "ok" as const,
    };

    sections[sectionId] = { files };
    updatedCourses[courseIdStr] = { name: courseName, sections };
  }

  // Save state
  await stateManager.save({ courses: updatedCourses });
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
