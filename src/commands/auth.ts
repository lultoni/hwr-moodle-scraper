// REQ-AUTH-007, REQ-AUTH-008, REQ-CLI-003, REQ-CLI-004, REQ-CLI-005
import { EXIT_CODES } from "../exit-codes.js";
import type { KeychainAdapter } from "../auth/keychain.js";
import { deleteSessionFile, validateOrRefreshSession } from "../auth/session.js";
import { promptAndAuthenticate, AuthError, type PromptFn } from "../auth/prompt.js";
import type { HttpClient } from "../http/client.js";
import type { Logger } from "../logger.js";

export interface AuthClearOptions {
  keychain: KeychainAdapter | null;
  force?: boolean;
  promptFn?: PromptFn;
}

export async function runAuthClear(opts: AuthClearOptions): Promise<void> {
  const { keychain, force = false, promptFn } = opts;
  if (!keychain) {
    process.stdout.write("No credential storage available on this platform.\n");
    return;
  }
  const creds = await keychain.readCredentials();
  if (!creds) {
    process.stdout.write("No credentials stored.\n");
    return;
  }
  if (!force && promptFn) {
    const answer = await promptFn("Credentials already stored. Clear them? [y/N] ");
    if (answer.trim().toLowerCase() !== "y") return;
  }
  await keychain.deleteCredentials();
  await deleteSessionFile();
  process.stdout.write("Credentials and session cleared.\n");
}

export interface AuthStatusOptions {
  keychain: KeychainAdapter | null;
  httpClient?: HttpClient;
  baseUrl?: string;
}

export async function runAuthStatus(opts: AuthStatusOptions): Promise<void> {
  const { keychain, httpClient, baseUrl } = opts;
  if (!keychain) {
    const envUser = process.env["MSC_USERNAME"];
    if (envUser) {
      process.stdout.write(`Credential storage: env vars (MSC_USERNAME=${envUser})\n`);
    } else {
      process.stdout.write("Credential storage: not available. Set MSC_USERNAME and MSC_PASSWORD environment variables.\n");
    }
    return;
  }
  const creds = await keychain.readCredentials();
  if (!creds) {
    process.stdout.write("Credentials: not stored\n");
    return;
  }
  process.stdout.write(`Credentials: stored (username: ${creds.username})\n`);
  if (httpClient) {
    try {
      await validateOrRefreshSession({ httpClient, keychain, ...(baseUrl ? { baseUrl } : {}) });
      process.stdout.write("Session: valid\n");
    } catch {
      process.stdout.write("Session: expired or invalid\n");
    }
  }
}

export interface AuthSetOptions {
  keychain: KeychainAdapter | null;
  promptFn: PromptFn;
  nonInteractive?: boolean;
  httpClient?: HttpClient;
  baseUrl?: string;
  logger?: Logger;
}

export async function runAuthSet(opts: AuthSetOptions): Promise<void> {
  const { keychain, promptFn, nonInteractive = false, httpClient, baseUrl, logger } = opts;
  if (!keychain) {
    process.stdout.write("Credential storage is not available on this platform.\n");
    process.stdout.write("Set MSC_USERNAME and MSC_PASSWORD environment variables instead.\n");
    process.stdout.write("Example (bash/zsh):\n");
    process.stdout.write("  export MSC_USERNAME=s12345\n");
    process.stdout.write("  export MSC_PASSWORD=yourpass\n");
    process.stdout.write("Note: Configuring env vars is optional — msc scrape will prompt you each run otherwise.\n");
    return;
  }
  const existing = await keychain.readCredentials();
  if (existing) {
    if (nonInteractive) {
      throw Object.assign(
        new Error("Credentials already stored. Use --force to replace in non-interactive mode."),
        { exitCode: EXIT_CODES.USAGE_ERROR }
      );
    }
    const answer = await promptFn("Credentials already stored. Replace? [y/N] ");
    if (answer.trim().toLowerCase() !== "y") return;
  }
  if (httpClient) {
    await promptAndAuthenticate({ promptFn, httpClient, keychain, ...(baseUrl ? { baseUrl } : {}), ...(logger ? { logger } : {}) });
  }
}
