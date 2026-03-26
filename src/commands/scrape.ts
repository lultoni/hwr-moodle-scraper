// REQ-CLI-002, REQ-CLI-008, REQ-CLI-009, REQ-CLI-010
import { validateOrRefreshSession } from "../auth/session.js";
import { fetchCourseList, fetchContentTree } from "../scraper/courses.js";
import { computeSyncPlan, SyncAction } from "../sync/incremental.js";
import { StateManager } from "../sync/state.js";
import { KeychainAdapter } from "../auth/keychain.js";
import { createHttpClient } from "../http/client.js";
import { createLogger, LogLevel } from "../logger.js";
import { EXIT_CODES } from "../exit-codes.js";

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
}

export async function runScrape(opts: ScrapeOptions): Promise<void> {
  const {
    outputDir,
    dryRun,
    force,
    baseUrl = "https://moodle.hwr-berlin.de",
    nonInteractive = false,
    quiet = false,
    verbose = false,
  } = opts;

  const level = quiet ? LogLevel.ERROR : verbose ? LogLevel.DEBUG : LogLevel.INFO;
  const logger = createLogger({ level, redact: [] });

  const httpClient = createHttpClient();
  const keychain = new KeychainAdapter();
  const stateManager = new StateManager(outputDir);

  // Auth
  await validateOrRefreshSession({
    httpClient,
    keychain,
    baseUrl,
    interactivePromptFallback: nonInteractive ? undefined : undefined,
  });

  // Course list
  const courses = await fetchCourseList({ baseUrl, sessionCookies: "" });

  // Load state
  const state = await stateManager.load() ?? { courses: {} };

  // Content trees
  const trees = await Promise.all(
    courses.map((c) => fetchContentTree({ baseUrl, courseId: c.courseId, sessionCookies: "" }))
  );

  // Sync plan
  const plan = computeSyncPlan({ state, currentTree: trees, force, dryRun });

  if (!dryRun) {
    // Execute downloads (simplified — full implementation in developer phase)
    const downloads = plan.filter((p) => p.action === SyncAction.DOWNLOAD);
    logger.info(`${downloads.length} file(s) to download`);
  } else {
    for (const item of plan) {
      logger.info(`[dry-run] ${item.action} ${item.resourceId ?? ""}`);
    }
  }

  // Save state
  if (!dryRun) {
    await stateManager.save({ courses: state.courses });
  }
}
