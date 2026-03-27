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

  const defaultDir = ((await config.get("outputDir")) as string | undefined)
    ?? `${process.env.HOME ?? homedir()}/moodle-scraper-output`;
  const inputDir = await promptFn(`Output directory [${defaultDir}]: `);
  const outputDir = inputDir.trim() || defaultDir;
  await config.set("outputDir", outputDir);

  await promptAndAuthenticate({ promptFn, httpClient, keychain, logger });
}
