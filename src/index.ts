#!/usr/bin/env node
// REQ-CLI-001, REQ-CLI-011, REQ-CLI-013, REQ-CLI-014
import { Command } from "commander";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_CODES } from "./exit-codes.js";
import { ConfigManager, CONFIG_DESCRIPTIONS } from "./config.js";
import { tryCreateKeychain } from "./auth/keychain.js";
import { createHttpClient } from "./http/client.js";
import { createLogger, LogLevel, type Logger } from "./logger.js";
import { runScrape } from "./commands/scrape.js";
import { runAuthSet, runAuthClear, runAuthStatus } from "./commands/auth.js";
import { runStatus } from "./commands/status.js";
import { runClean } from "./commands/clean.js";
import { runReset } from "./commands/reset.js";
import { runWizard, shouldRunWizard } from "./commands/wizard.js";
import { runTui } from "./commands/tui.js";
import { runHelp } from "./commands/help.js";
import { runArchive } from "./commands/archive.js";
import { runUpdateCheck } from "./version-check.js";
import { StateManager } from "./sync/state.js";
import { matchCourses } from "./scraper/course-filter.js";

// Global error handlers — prevent unredacted stack traces from leaking sensitive data
process.on("uncaughtException", (err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(EXIT_CODES.ERROR);
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`Fatal error: ${reason instanceof Error ? reason.message : String(reason)}\n`);
  process.exit(EXIT_CODES.ERROR);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf8")
) as { version: string; name: string };

// --- interactive prompt helper ---
// For masked input (passwords): use a muted output stream so readline still
// functions correctly in a TTY but never echoes characters to the terminal.
function makePromptFn() {
  return async (prompt: string, masked = false): Promise<string> => {
    process.stdout.write(prompt);
    const output = masked
      ? new (await import("node:stream")).Writable({ write(_chunk, _enc, cb) { cb(); } })
      : process.stdout;
    const rl = createInterface({ input: process.stdin, output, terminal: masked });
    return new Promise((resolve) => {
      rl.question("", (answer) => {
        rl.close();
        if (masked) process.stdout.write("\n");
        resolve(answer);
      });
    });
  };
}

const program = new Command();

program
  .name("moodle-scraper")
  .description("Download all content from HWR Berlin Moodle LMS")
  .version(`moodle-scraper ${pkg.version}`, "-V, --version", "Print version and exit")
  .option("--debug", "Enable verbose debug output (HTTP requests, auth flow)", false)
  .addHelpCommand(false);

function makeLogger(debug: boolean, redact: string[] = []): Logger | undefined {
  if (!debug) return undefined;
  return createLogger({ level: LogLevel.DEBUG, redact, logFile: null });
}

/** Spread only if value is defined — respects exactOptionalPropertyTypes. */
function withLogger(logger: Logger | undefined): { logger: Logger } | Record<never, never> {
  return logger ? { logger } : {};
}


// --- scrape ---
program
  .command("scrape")
  .description("Download / sync Moodle content to local folder")
  .option("--output-dir <path>", "Override output directory for this run")
  .option("--courses <keywords>", "Comma-separated keywords to filter courses (fuzzy match against course names)")
  .option("--course-ids <ids>", "Comma-separated numeric course IDs to scrape (exact match)")
  .option("--force", "Re-download everything, ignoring cached state", false)
  .option("--check-files", "Re-download any files missing from disk (even if state says up-to-date)", false)
  .option("--dry-run", "Print planned actions without writing files", false)
  .option("--metadata", "Write .meta.json sidecar alongside each file", false)
  .option("-q, --quiet", "Suppress all output except errors", false)
  .option("-v, --verbose", "Debug-level output", false)
  .option("--non-interactive", "Exit instead of prompting for credentials", false)
  .option("--skip-disk-check", "Skip the minimum free disk space check", false)
  .option("--no-descriptions", "Skip description .md files and .url.txt — download binary/PDF files only")
  .option("--json", "Output machine-readable JSON summary to stdout", false)
  .option("--fast", "Speed up: requestDelayMs=200, maxConcurrentDownloads=8 (heavier on server)", false)
  .action(async (opts: {
    outputDir?: string;
    courses?: string;
    courseIds?: string;
    force: boolean;
    checkFiles: boolean;
    dryRun: boolean;
    metadata: boolean;
    quiet: boolean;
    verbose: boolean;
    nonInteractive: boolean;
    skipDiskCheck: boolean;
    descriptions: boolean;  // commander negates --no-descriptions to descriptions=false
    json: boolean;
    fast: boolean;
  }) => {
    const globalOpts = program.opts<{ debug: boolean }>();
    const config = new ConfigManager();
    const keychain = tryCreateKeychain();
    const httpClient = createHttpClient();
    // Password will be added to redact list once collected
    const logger = makeLogger(globalOpts.debug);

    // Fire update check early — resolved after command finishes (non-blocking)
    const updateCheckPromise = runUpdateCheck(config, pkg.version, opts.quiet);

    // First-run wizard
    if (await shouldRunWizard({ keychain, config })) {
      await runWizard({ keychain, config, promptFn: makePromptFn(), httpClient, nonInteractive: opts.nonInteractive, ...withLogger(logger) });
    }

    // Register stored password in logger so it's always redacted
    if (logger && keychain) {
      const creds = await keychain.readCredentials();
      if (creds?.password) logger.addSecret(creds.password);
    }

    const outputDir = opts.outputDir ?? (await config.get("outputDir")) as string;
    const promptFn = makePromptFn();
    const scrapeOpts: Parameters<typeof runScrape>[0] = {
      outputDir,
      dryRun: opts.dryRun,
      force: opts.force,
      checkFiles: opts.checkFiles,
      skipDiskCheck: opts.skipDiskCheck,
      nonInteractive: opts.nonInteractive,
      quiet: opts.quiet,
      verbose: opts.verbose,
      metadata: opts.metadata,
      noDescriptions: opts.descriptions === false,
      json: opts.json,
      fast: opts.fast,
      ...(!opts.nonInteractive ? { promptFn } : {}),
      ...withLogger(logger),
    };
    if (opts.courseIds) {
      scrapeOpts.courses = opts.courseIds.split(",").map(Number).filter((n) => !isNaN(n));
    } else if (opts.courses) {
      const state = await new StateManager(outputDir).load();
      const { ids, unmatched } = matchCourses(opts.courses, state);
      if (unmatched.length) {
        process.stderr.write(`[msc] No courses matched: ${unmatched.join(", ")}\n`);
        if (!state || Object.keys(state.courses).length === 0) {
          process.stderr.write("[msc] No courses in state yet. Run `msc scrape` without --courses first.\n");
        } else {
          process.stderr.write("[msc] Available courses:\n");
          for (const c of Object.values(state.courses)) {
            process.stderr.write(`[msc]   • ${c.name}\n`);
          }
        }
      }
      if (ids.length > 0) scrapeOpts.courses = ids;
    }

    try {
      await runScrape(scrapeOpts);
    } catch (err) {
      const code = (err as { exitCode?: number }).exitCode ?? EXIT_CODES.ERROR;
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(code);
    }

    await updateCheckPromise;
  });

// --- auth ---
const auth = program.command("auth").description("Manage Moodle credentials");

auth
  .command("set")
  .description("Store Moodle credentials in macOS Keychain")
  .option("--non-interactive", "Fail instead of prompting", false)
  .action(async (opts: { nonInteractive: boolean }) => {
    const globalOpts = program.opts<{ debug: boolean }>();
    const keychain = tryCreateKeychain();
    const httpClient = createHttpClient();
    const logger = makeLogger(globalOpts.debug);
    const mgr = new ConfigManager();
    try {
      await runAuthSet({ keychain, promptFn: makePromptFn(), nonInteractive: opts.nonInteractive, httpClient, ...withLogger(logger) });
    } catch (err) {
      const code = (err as { exitCode?: number }).exitCode ?? EXIT_CODES.ERROR;
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(code);
    }
    await runUpdateCheck(mgr, pkg.version, false);
  });

auth
  .command("clear")
  .description("Remove stored credentials and session")
  .option("--force", "Skip confirmation prompt", false)
  .action(async (opts: { force: boolean }) => {
    const keychain = tryCreateKeychain();
    const clearOpts: Parameters<typeof runAuthClear>[0] = { keychain, force: opts.force };
    if (!opts.force) clearOpts.promptFn = makePromptFn();
    const mgr = new ConfigManager();
    try {
      await runAuthClear(clearOpts);
    } catch (err) {
      const code = (err as { exitCode?: number }).exitCode ?? EXIT_CODES.ERROR;
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(code);
    }
    await runUpdateCheck(mgr, pkg.version, false);
  });

auth
  .command("status")
  .description("Check if credentials and session are valid")
  .action(async () => {
    const keychain = tryCreateKeychain();
    const httpClient = createHttpClient();
    const mgr = new ConfigManager();
    try {
      await runAuthStatus({ keychain, httpClient });
    } catch (err) {
      const code = (err as { exitCode?: number }).exitCode ?? EXIT_CODES.ERROR;
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(code);
    }
    await runUpdateCheck(mgr, pkg.version, false);
  });

// --- config ---
const config = program.command("config").description("View and set configuration values");

config
  .command("get <key>")
  .description("Print a config value")
  .action(async (key: string) => {
    const mgr = new ConfigManager();
    const value = await mgr.get(key as Parameters<ConfigManager["get"]>[0]);
    process.stdout.write(`${value ?? ""}\n`);
  });

config
  .command("set <key> <value>")
  .description("Set a config value")
  .action(async (key: string, value: string) => {
    const mgr = new ConfigManager();
    const numericKeys = ["minFreeDiskMb", "maxConcurrentDownloads", "requestDelayMs", "requestJitterMs", "retryBaseDelayMs", "updateCheckIntervalHours"];
    const coerced = numericKeys.includes(key) ? Number(value) : value;
    await mgr.set(key as Parameters<ConfigManager["set"]>[0], coerced as Parameters<ConfigManager["set"]>[1]);
  });

config
  .command("list")
  .description("Print all config values")
  .action(async () => {
    const mgr = new ConfigManager();
    const all = await mgr.list();
    const maxKeyLen = Math.max(...Object.keys(all).map((k) => k.length));
    for (const [k, v] of Object.entries(all)) {
      const desc = CONFIG_DESCRIPTIONS[k as keyof typeof CONFIG_DESCRIPTIONS];
      const descStr = desc ? `  # ${desc}` : "";
      process.stdout.write(`${k.padEnd(maxKeyLen)}=${v ?? ""}${descStr}\n`);
    }
    await runUpdateCheck(mgr, pkg.version, false);
  });

config
  .command("reset")
  .description("Reset all config values to defaults")
  .option("--non-interactive", "Skip confirmation prompt", false)
  .action(async (opts: { nonInteractive: boolean }) => {
    if (!opts.nonInteractive) {
      const answer = await makePromptFn()("Reset all config to defaults? [y/N] ");
      if (answer.trim().toLowerCase() !== "y") return;
    }
    const mgr = new ConfigManager();
    await mgr.reset();
    process.stdout.write("Config reset to defaults.\n");
  });

// --- status ---
program
  .command("status")
  .description("Show last sync summary")
  .option("--issues", "List orphaned files", false)
  .option("--changed", "Show files changed in the last scrape run", false)
  .option("--dismiss-orphans", "Remove old state entries from ended courses", false)
  .option("--dry-run", "Preview changes without writing", false)
  .option("--json", "Output machine-readable JSON to stdout", false)
  .action(async (opts: { issues: boolean; changed: boolean; dismissOrphans: boolean; dryRun: boolean; json: boolean }) => {
    const mgr = new ConfigManager();
    const outputDir = (await mgr.get("outputDir")) as string;
    try {
      await runStatus({ outputDir, showIssues: opts.issues, showChanged: opts.changed, dismissOrphans: opts.dismissOrphans, dryRun: opts.dryRun, json: opts.json });
    } catch (err) {
      const code = (err as { exitCode?: number }).exitCode ?? EXIT_CODES.ERROR;
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(code);
    }
    await runUpdateCheck(mgr, pkg.version, false);
  });

// --- clean ---
program
  .command("clean")
  .description("Delete or move personal files you added to the output folder (scraper files are never touched)")
  .option("--move", 'Move files to "User Files/" folder instead of deleting', false)
  .option("--dry-run", "Show what would happen without acting", false)
  .option("--force", "Skip confirmation prompt", false)
  .action(async (opts: { move: boolean; dryRun: boolean; force: boolean }) => {
    const mgr = new ConfigManager();
    const outputDir = (await mgr.get("outputDir")) as string;
    if (!outputDir) {
      process.stderr.write("Error: outputDir is not configured.\n");
      process.exit(EXIT_CODES.USAGE_ERROR);
    }
    try {
      await runClean({
        outputDir,
        move: opts.move,
        dryRun: opts.dryRun,
        force: opts.force,
        ...(!opts.force ? { promptFn: makePromptFn() } : {}),
      });
    } catch (err) {
      const code = (err as { exitCode?: number }).exitCode ?? EXIT_CODES.ERROR;
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(code);
    }
    await runUpdateCheck(mgr, pkg.version, false);
  });

// --- reset ---
program
  .command("reset")
  .description("Clear sync state, scraped files, config, or credentials (combine flags freely)")
  .option("--state", "Clear sync state only — files on disk are untouched", false)
  .option("--files", "Delete all scraper-tracked files + clear state", false)
  .option("--config", "Reset config to defaults", false)
  .option("--credentials", "Clear saved credentials and session cookie", false)
  .option("--full", "Alias for --files --config --credentials (backwards compatible)", false)
  .option("--force", "Skip confirmation prompt", false)
  .option("--dry-run", "Print what would be changed without making any changes", false)
  .option("--move-user-files", "Interactively move user-owned files before reset", false)
  .action(async (opts: { state: boolean; files: boolean; config: boolean; credentials: boolean; full: boolean; force: boolean; dryRun: boolean; moveUserFiles: boolean }) => {
    const mgr = new ConfigManager();
    const outputDir = (await mgr.get("outputDir")) as string;
    if (!outputDir) {
      process.stderr.write("Error: outputDir is not configured.\n");
      process.exit(EXIT_CODES.USAGE_ERROR);
    }
    try {
      await runReset({
        outputDir,
        state: opts.state,
        files: opts.files,
        config: opts.config,
        credentials: opts.credentials,
        full: opts.full,
        force: opts.force,
        dryRun: opts.dryRun,
        moveUserFiles: opts.moveUserFiles,
        ...(!opts.force ? { promptFn: makePromptFn() } : {}),
      });
    } catch (err) {
      const code = (err as { exitCode?: number }).exitCode ?? EXIT_CODES.ERROR;
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(code);
    }
    await runUpdateCheck(mgr, pkg.version, false);
  });

// --- tui ---
program
  .command("tui")
  .description("Launch interactive terminal UI")
  .action(async () => {
    const mgr = new ConfigManager();
    try {
      await runTui({ promptFn: makePromptFn(), version: pkg.version });
    } catch (err) {
      const code = (err as { exitCode?: number }).exitCode ?? EXIT_CODES.ERROR;
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(code);
    }
    await runUpdateCheck(mgr, pkg.version, false);
  });

// --- help ---
program
  .command("help [topic]")
  .description("Show plain-language help for a topic (e.g. orphaned, user-files, reset)")
  .action((topic?: string) => {
    runHelp(topic);
  });

// --- archive ---
program
  .command("archive")
  .description("Remove courses from sync state (files on disk are untouched)")
  .option("--courses <keywords>", "Comma-separated keywords to match course names")
  .option("--dry-run", "Preview without making changes", false)
  .option("--force", "Skip confirmation prompt", false)
  .action(async (opts: { courses?: string; dryRun: boolean; force: boolean }) => {
    const mgr = new ConfigManager();
    const outputDir = (await mgr.get("outputDir")) as string;
    try {
      await runArchive({
        outputDir,
        ...(opts.courses !== undefined ? { courses: opts.courses } : {}),
        dryRun: opts.dryRun,
        force: opts.force,
        ...(!opts.force ? { promptFn: makePromptFn() } : {}),
      });
    } catch (err) {
      const code = (err as { exitCode?: number }).exitCode ?? EXIT_CODES.ERROR;
      process.stderr.write(`Error: ${(err as Error).message}\n`);
      process.exit(code);
    }
    await runUpdateCheck(mgr, pkg.version, false);
  });

// --- unknown command handler — REQ-CLI-011 ---
program.on("command:*", (args: string[]) => {
  process.stderr.write(
    `Unknown command: ${args[0]}. Run moodle-scraper --help for usage.\n`
  );
  process.exit(EXIT_CODES.USAGE_ERROR);
});

program.parse(process.argv);
