// REQ-CLI-002, REQ-CLI-008, REQ-CLI-009, REQ-CLI-010
import { validateOrRefreshSession } from "../auth/session.js";
import { fetchCourseList, fetchContentTree, fetchFolderFiles, type Course, type ContentTree, type Activity, type Section } from "../scraper/courses.js";
import { buildDownloadPlan, type DownloadPlanItem } from "../scraper/dispatch.js";
import { computeSyncPlan, SyncAction } from "../sync/incremental.js";
import { StateManager, type CourseState } from "../sync/state.js";
import { KeychainAdapter } from "../auth/keychain.js";
import { createHttpClient } from "../http/client.js";
import { createLogger, LogLevel, type Logger } from "../logger.js";
import { ConfigManager } from "../config.js";
import { buildOutputPath } from "../fs/output.js";
import { DownloadQueue, type DownloadItem } from "../scraper/downloader.js";
import { writeUrlFile } from "../scraper/content-types.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { writeFile } from "node:fs/promises";

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
          for (const activity of section.activities) {
            if (activity.activityType === "folder" && activity.url) {
              logger.debug(`  Expanding folder: ${activity.activityName}`);
              const files = await fetchFolderFiles({ baseUrl, folderUrl: activity.url, sessionCookies });
              for (const f of files) {
                expandedActivities.push({
                  activityType: "resource",
                  activityName: f.name,
                  url: f.url,
                  isAccessible: true,
                  resourceId: `folder-${activity.activityName}-${f.name}`,
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
        const resourceId = activity.resourceId ?? `${tree.courseId}-${section.sectionId}-${activity.activityName}`;
        resourceSectionMap.set(resourceId, { courseId: tree.courseId, sectionId: section.sectionId, hash: activity.hash ?? "" });
      }
    }
  }

  // Sync plan
  const plan = computeSyncPlan({ state, currentTree: expandedTrees, force, dryRun });

  const downloads = plan.filter((p) => p.action === SyncAction.DOWNLOAD);
  const skipped = plan.filter((p) => p.action === SyncAction.SKIP);

  if (dryRun) {
    for (const item of plan) {
      logger.info(`[dry-run] ${item.action} ${item.resourceId ?? ""}`);
    }
    return;
  }

  logger.debug(`Sync plan: ${downloads.length} to download, ${skipped.length} to skip.`);

  // Build a map from resourceId → Activity for dispatch
  const activityByResourceId = new Map<string, { activity: Activity; courseName: string; sectionName: string }>();
  for (const tree of expandedTrees) {
    for (const section of tree.sections) {
      const courseName = courseNameMap.get(tree.courseId) ?? String(tree.courseId);
      const sectionName = sectionNameMap.get(`${tree.courseId}:${section.sectionId}`) ?? "General";
      for (const activity of section.activities) {
        const resourceId = activity.resourceId ?? `${tree.courseId}-${section.sectionId}-${activity.activityName}`;
        activityByResourceId.set(resourceId, { activity, courseName, sectionName });
      }
    }
  }

  const maxConcurrent = ((await config.get("maxConcurrentDownloads")) as number | undefined) ?? 3;

  // Separate binary downloads from special-handling types
  const binaryItems: DownloadItem[] = [];
  const specialItems: Array<{ item: typeof downloads[0]; destPath: string; strategy: string }> = [];

  for (const item of downloads) {
    if (!item.url || !item.courseId) continue;

    const resourceId = item.resourceId ?? "";
    const meta = activityByResourceId.get(resourceId);
    const courseName = meta?.courseName ?? (courseNameMap.get(item.courseId) ?? String(item.courseId));
    const sectionName = meta?.sectionName ?? "General";

    if (!meta?.activity) {
      // Fallback: treat as binary download using URL-derived filename
      const urlPathname = new URL(item.url).pathname;
      const rawSegment = urlPathname.split("/").pop() ?? "";
      const filenameDerived = decodeURIComponent(rawSegment) || resourceId || "file";
      const destPath = await buildOutputPath({ outputDir, courseName, sectionName, filename: filenameDerived });
      logger.debug(`Queuing (binary): ${courseName} / ${sectionName} / ${filenameDerived}`);
      binaryItems.push({ url: item.url, destPath, sessionCookies });
      continue;
    }

    const [planItem] = buildDownloadPlan([meta.activity], courseName, sectionName, outputDir);
    if (!planItem) continue;

    if (planItem.strategy === "binary") {
      logger.debug(`Queuing (binary): ${courseName} / ${sectionName} / ${meta.activity.activityName}`);
      mkdirSync(dirname(planItem.destPath), { recursive: true });
      binaryItems.push({ url: planItem.url, destPath: planItem.destPath, sessionCookies });
    } else {
      logger.debug(`Queuing (${planItem.strategy}): ${courseName} / ${sectionName} / ${meta.activity.activityName}`);
      specialItems.push({ item, destPath: planItem.destPath, strategy: planItem.strategy });
    }
  }

  // Execute binary downloads via queue
  if (binaryItems.length > 0) {
    const queue = new DownloadQueue({ maxConcurrent });
    await queue.run(binaryItems);
  }

  // Execute special-type downloads sequentially
  let TurndownService: typeof import("turndown") | undefined;
  for (const { item, destPath, strategy } of specialItems) {
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
      }
    } catch (err) {
      logger.debug(`  Warning: failed to download ${item.url} — ${(err as Error).message}`);
    }
  }

  const totalDownloaded = binaryItems.length + specialItems.length;
  logger.info(`Done: ${totalDownloaded} downloaded, ${skipped.length} skipped.`);

  // Update state with downloaded files
  const updatedCourses: Record<string, CourseState> = { ...(state.courses as Record<string, CourseState>) };

  const allDownloadedItems = [
    ...binaryItems.map((bi, i) => ({ item: downloads[i], destPath: bi.destPath })),
    ...specialItems.map((si) => ({ item: si.item, destPath: si.destPath })),
  ];

  for (const { item, destPath } of allDownloadedItems) {
    if (!item || !item.courseId || !item.url) continue;

    const courseIdStr = String(item.courseId);
    const courseName = courseNameMap.get(item.courseId) ?? String(item.courseId);
    const resourceId = item.resourceId ?? "";
    const location = resourceSectionMap.get(resourceId);
    const sectionId = location?.sectionId ?? "s0";

    const courseEntry = updatedCourses[courseIdStr] ?? { name: courseName, sections: {} };
    const sections = { ...(courseEntry.sections ?? {}) };
    const sectionEntry = sections[sectionId] ?? { files: {} };
    const files = { ...(sectionEntry.files ?? {}) };

    files[resourceId] = {
      name: filenameFn(item.url, resourceId),
      url: item.url,
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
