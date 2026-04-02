// REQ-CLI-015
import { EXIT_CODES } from "../exit-codes.js";
import { homedir } from "node:os";
import type { KeychainAdapter } from "../auth/keychain.js";
import type { HttpClient } from "../http/client.js";
import { promptAndAuthenticate, type PromptFn } from "../auth/prompt.js";
import type { Logger } from "../logger.js";

// Minimal interface — allows ConfigManager or any mock
interface AnyConfig {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface WizardOptions {
  keychain: KeychainAdapter;
  config: AnyConfig;
  promptFn: PromptFn;
  httpClient: HttpClient;
  nonInteractive?: boolean;
  logger?: Logger;
}

export async function shouldRunWizard(opts: { keychain: KeychainAdapter; config: AnyConfig }): Promise<boolean> {
  const creds = await opts.keychain.readCredentials();
  return creds == null; // null or undefined = not configured
}

export async function runWizard(opts: WizardOptions): Promise<void> {
  const { keychain, config, promptFn, httpClient, nonInteractive = false, logger } = opts;

  const creds = await keychain.readCredentials();
  if (creds != null) return; // already configured (null or undefined = not set)

  if (nonInteractive) {
    throw Object.assign(
      new Error("No credentials stored. Run without --non-interactive to set up."),
      { exitCode: EXIT_CODES.AUTH_ERROR }
    );
  }

  // Output directory
  const stored = ((await config.get("outputDir")) as string | undefined) ?? "";
  const hint = stored || `${homedir()}/moodle-scraper-output`;
  const inputDir = await promptFn(`Output directory [${hint}]: `);
  await config.set("outputDir", inputDir.trim() || hint);

  // Credentials
  await promptAndAuthenticate({ promptFn, httpClient, keychain, ...(logger ? { logger } : {}) });

  // SK course placement
  const skInput = (await promptFn("SK placement [separate/in-semester] (default: separate): ")).trim();
  const skPlacement = skInput === "in-semester" ? "in-semester" : "separate";
  await config.set("skPlacement", skPlacement);
  if (skPlacement === "in-semester") {
    const skSem = (await promptFn("Which semester folder? (e.g. Semester_3): ")).trim();
    await config.set("skSemester", skSem);
  }

  // Log file
  const logInput = (await promptFn("Log file path (press Enter to skip): ")).trim();
  await config.set("logFile", logInput || null);
}
