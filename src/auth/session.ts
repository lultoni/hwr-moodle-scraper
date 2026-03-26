// REQ-AUTH-004, REQ-AUTH-005
import { EXIT_CODES } from "../exit-codes.js";
import type { KeychainAdapter } from "./keychain.js";
import type { HttpClient } from "../http/client.js";
import { AuthError } from "./prompt.js";

export async function deleteSessionFile(): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  try {
    await unlink(join(homedir(), ".config", "moodle-scraper", "session.json"));
  } catch {
    // ignore if not found
  }
}

export interface SessionOptions {
  httpClient: HttpClient;
  keychain: KeychainAdapter;
  baseUrl?: string;
  maxRetries?: number;
  interactivePromptFallback?: () => Promise<void>;
}

function isSessionExpired(responseUrl: string): boolean {
  return responseUrl.includes("/login/");
}

export async function validateOrRefreshSession(opts: SessionOptions): Promise<void> {
  const {
    httpClient,
    keychain,
    baseUrl = "https://moodle.hwr-berlin.de",
    maxRetries = 3,
    interactivePromptFallback,
  } = opts;

  // Validate session with a lightweight GET
  const response = await httpClient.get(`${baseUrl}/my/`);
  if (!isSessionExpired(response.url)) return; // session valid

  // Session expired — try Keychain credentials
  const creds = await keychain.readCredentials();
  if (!creds) {
    if (interactivePromptFallback) {
      await interactivePromptFallback();
      return;
    }
    throw new AuthError("No credentials stored.", EXIT_CODES.AUTH_ERROR);
  }

  // Silent re-authentication
  process.stderr.write("Session expired, re-authenticating…\n");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const reAuthResponse = await httpClient.post(`${baseUrl}/login/index.php`, {
      username: creds.username,
      password: creds.password,
    });
    if (!isSessionExpired(reAuthResponse.url)) return; // success
  }

  throw Object.assign(
    new Error(`Authentication failed after ${maxRetries} attempts.`),
    { exitCode: EXIT_CODES.AUTH_ERROR }
  );
}
