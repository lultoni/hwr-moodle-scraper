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
  // Env-var credentials count as "auth covered" — no wizard needed for auth alone
  const envCreds = !!(process.env["MSC_USERNAME"] && process.env["MSC_PASSWORD"]);
  const creds = opts.keychain ? await opts.keychain.readCredentials() : null;
  if (creds == null && !envCreds) return true; // no auth at all → wizard needed
  const outputDir = (await opts.config.get("outputDir")) as string | undefined;
  return !outputDir; // outputDir missing → wizard still needed
}

export async function runWizard(opts: WizardOptions): Promise<void> {
  const { keychain, config, promptFn, httpClient, nonInteractive = false, logger } = opts;

  const envCreds = !!(process.env["MSC_USERNAME"] && process.env["MSC_PASSWORD"]);
  const creds = keychain ? await keychain.readCredentials() : null;
  const storedOutputDir = ((await config.get("outputDir")) as string | undefined) ?? "";

  // Nothing to do: auth is covered (stored or env) and outputDir is set
  if ((creds != null || envCreds) && storedOutputDir) return;

  if (nonInteractive) {
    throw Object.assign(
      new Error("No credentials stored. Run without --non-interactive to set up."),
      { exitCode: EXIT_CODES.AUTH_ERROR }
    );
  }

  // Output directory — only ask if not already configured
  if (!storedOutputDir) {
    const hint = `${homedir()}/moodle-scraper-output`;
    const inputDir = await promptFn(`Output directory [${hint}]: `);
    await config.set("outputDir", inputDir.trim() || hint);
    // Log file is only asked on first-time outputDir setup
    const logInput = (await promptFn("Log file path (press Enter to skip): ")).trim();
    await config.set("logFile", logInput || null);
  }

  // Credentials — only ask if not covered by stored creds or env vars
  if (creds == null && !envCreds) {
    await promptAndAuthenticate({ promptFn, httpClient, keychain, ...(logger ? { logger } : {}) });
  }
}
