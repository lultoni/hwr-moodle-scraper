// REQ-CLI-002, REQ-CLI-008, REQ-CLI-009, REQ-CLI-010
import { validateOrRefreshSession } from "../auth/session.js";
import { fetchCourseList, fetchContentTree, type Course, type ContentTree } from "../scraper/courses.js";
import { computeSyncPlan, SyncAction } from "../sync/incremental.js";
import { StateManager, type CourseState } from "../sync/state.js";
import { KeychainAdapter } from "../auth/keychain.js";
import { createHttpClient } from "../http/client.js";
import { createLogger, LogLevel, type Logger } from "../logger.js";
import { ConfigManager } from "../config.js";
import { buildOutputPath } from "../fs/output.js";
import { DownloadQueue, type DownloadItem } from "../scraper/downloader.js";

export interface ScrapeOptions {
  outputDir: string;
  dryRun: boolean;
  force: boolean;
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

  // Course list
  const courses: Course[] = opts.courses
    ? opts.courses.map((id) => ({ courseId: id, courseName: String(id), courseUrl: `${baseUrl}/course/view.php?id=${id}` }))
    : await fetchCourseList({
        baseUrl,
        sessionCookies,
        ...(searchQuery ? { searchQuery } : {}),
      });

  if (courses.length === 0) {
    logger.info("No courses found. Set a search query with: moodle-scraper config set courseSearch <query>");
    return;
  }

  logger.info(`Found ${courses.length} course(s).`);

  // Build courseId → courseName lookup
  const courseNameMap = new Map<number, string>();
  for (const course of courses) {
    courseNameMap.set(course.courseId, course.courseName);
  }

  // Load state
  const state = await stateManager.load() ?? { courses: {} };

  logger.debug("Fetching content trees…");

  // Content trees — fetch in parallel
  const trees: ContentTree[] = await Promise.all(
    courses.map((c) => fetchContentTree({ baseUrl, courseId: c.courseId, sessionCookies }))
  );

  // Build (courseId, sectionId) → sectionName lookup
  const sectionNameMap = new Map<string, string>();
  for (const tree of trees) {
    for (const section of tree.sections) {
      sectionNameMap.set(`${tree.courseId}:${section.sectionId}`, section.sectionName);
    }
  }

  // Build resourceId → { sectionId, hash } lookup for state saving
  const resourceSectionMap = new Map<string, { courseId: number; sectionId: string; hash: string }>();
  for (const tree of trees) {
    for (const section of tree.sections) {
      for (const activity of section.activities) {
        const resourceId = activity.resourceId ?? `${tree.courseId}-${section.sectionId}-${activity.activityName}`;
        resourceSectionMap.set(resourceId, { courseId: tree.courseId, sectionId: section.sectionId, hash: activity.hash ?? "" });
      }
    }
  }

  // Sync plan
  const plan = computeSyncPlan({ state, currentTree: trees, force, dryRun });

  const downloads = plan.filter((p) => p.action === SyncAction.DOWNLOAD);
  const skipped = plan.filter((p) => p.action === SyncAction.SKIP);

  if (dryRun) {
    for (const item of plan) {
      logger.info(`[dry-run] ${item.action} ${item.resourceId ?? ""}`);
    }
    return;
  }

  logger.debug(`Sync plan: ${downloads.length} to download, ${skipped.length} to skip.`);

  // Enrich download items with output paths
  const maxConcurrent = ((await config.get("maxConcurrentDownloads")) as number | undefined) ?? 3;
  const downloadItems: DownloadItem[] = [];

  for (const item of downloads) {
    if (!item.url || !item.courseId) continue;

    const courseName = courseNameMap.get(item.courseId) ?? String(item.courseId);
    const resourceId = item.resourceId ?? "";
    const location = resourceSectionMap.get(resourceId);
    const sectionName = location
      ? (sectionNameMap.get(`${item.courseId}:${location.sectionId}`) ?? "General")
      : "General";

    // Derive filename from URL — last path segment, URL-decoded
    const urlPathname = new URL(item.url).pathname;
    const rawSegment = urlPathname.split("/").pop() ?? "";
    const filename = decodeURIComponent(rawSegment) || resourceId || "file";

    const destPath = await buildOutputPath({ outputDir, courseName, sectionName, filename });

    logger.debug(`Downloading: ${courseName} / ${sectionName} / ${filename}`);

    downloadItems.push({
      url: item.url,
      destPath,
      sessionCookies,
    });
  }

  // Execute downloads
  if (downloadItems.length > 0) {
    const queue = new DownloadQueue({ maxConcurrent });
    await queue.run(downloadItems);
  }

  logger.info(`Done: ${downloadItems.length} downloaded, ${skipped.length} skipped.`);

  // Update state with downloaded files
  const updatedCourses: Record<string, CourseState> = { ...(state.courses as Record<string, CourseState>) };

  for (let i = 0; i < downloads.length; i++) {
    const item = downloads[i];
    if (!item || !item.courseId || !item.url) continue;

    const courseIdStr = String(item.courseId);
    const courseName = courseNameMap.get(item.courseId) ?? String(item.courseId);
    const resourceId = item.resourceId ?? "";
    const location = resourceSectionMap.get(resourceId);
    const sectionId = location?.sectionId ?? "s0";

    const downloadItem = downloadItems[i];
    if (!downloadItem) continue;

    const courseEntry = updatedCourses[courseIdStr] ?? { name: courseName, sections: {} };
    const sections = { ...(courseEntry.sections ?? {}) };
    const sectionEntry = sections[sectionId] ?? { files: {} };
    const files = { ...(sectionEntry.files ?? {}) };

    files[resourceId] = {
      name: filename(item.url, resourceId),
      url: item.url,
      localPath: downloadItem.destPath,
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

/** Derive a filename from a URL, falling back to resourceId. */
function filename(url: string, fallback: string): string {
  try {
    const urlPathname = new URL(url).pathname;
    const raw = urlPathname.split("/").pop() ?? "";
    return decodeURIComponent(raw) || fallback || "file";
  } catch {
    return fallback || "file";
  }
}
