// REQ-CLI-015
import { EXIT_CODES } from "../exit-codes.js";
import { homedir } from "node:os";
import type { CredentialStore } from "../auth/keychain.js";
import type { HttpClient } from "../http/client.js";
import { promptAndAuthenticate, type PromptFn } from "../auth/prompt.js";
import type { Logger } from "../logger.js";

// Minimal interface — allows ConfigManager or any mock
interface AnyConfig {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface WizardOptions {
  keychain: CredentialStore | null;
  config: AnyConfig;
  promptFn: PromptFn;
  httpClient: HttpClient;
  nonInteractive?: boolean;
  logger?: Logger;
}

export async function shouldRunWizard(opts: { keychain: CredentialStore | null; config: AnyConfig }): Promise<boolean> {
  const creds = opts.keychain ? await opts.keychain.readCredentials() : null;
  if (creds == null) return true; // no credentials → always run wizard
  const outputDir = (await opts.config.get("outputDir")) as string | undefined;
  return !outputDir; // outputDir missing or empty → run wizard to reconfigure
}

export async function runWizard(opts: WizardOptions): Promise<void> {
  const { keychain, config, promptFn, httpClient, nonInteractive = false, logger } = opts;

  const creds = keychain ? await keychain.readCredentials() : null;
  const storedOutputDir = ((await config.get("outputDir")) as string | undefined) ?? "";

  // Nothing to do if both credentials and outputDir are already set
  if (creds != null && storedOutputDir) return;

  if (nonInteractive) {
    throw Object.assign(
      new Error("No credentials stored. Run without --non-interactive to set up."),
      { exitCode: EXIT_CODES.AUTH_ERROR }
    );
  }

  // Output directory (always ask if missing)
  const hint = storedOutputDir || `${homedir()}/moodle-scraper-output`;
  const inputDir = await promptFn(`Output directory [${hint}]: `);
  await config.set("outputDir", inputDir.trim() || hint);

  // Credentials (only ask if not already stored)
  if (creds == null) {
    await promptAndAuthenticate({ promptFn, httpClient, keychain, ...(logger ? { logger } : {}) });
  }

  // Log file
  const logInput = (await promptFn("Log file path (press Enter to skip): ")).trim();
  await config.set("logFile", logInput || null);
}
