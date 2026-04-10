// REQ-AUTH-004, REQ-AUTH-005
import { EXIT_CODES } from "../exit-codes.js";
import type { KeychainAdapter } from "./keychain.js";
import type { HttpClient } from "../http/client.js";
import { AuthError } from "./prompt.js";
import type { Logger } from "../logger.js";
import { extractCookies } from "../http/cookies.js";

export async function deleteSessionFile(): Promise<void> {
  const { unlink, lstat } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const sessionPath = join(homedir(), ".config", "moodle-scraper", "session.json");
  try {
    const stat = await lstat(sessionPath);
    if (stat.isSymbolicLink()) {
      // Refuse to follow symlinks — could indicate TOCTOU attack
      process.stderr.write(`Warning: session file at ${sessionPath} is a symlink — refusing to delete.\n`);
      return;
    }
    await unlink(sessionPath);
  } catch {
    // ignore if not found
  }
}

export interface SessionOptions {
  httpClient: HttpClient;
  keychain: KeychainAdapter | null;
  baseUrl?: string;
  maxRetries?: number;
  interactivePromptFallback?: () => Promise<void>;
  logger?: Logger;
}

/** Extract the logintoken CSRF field from Moodle's login page HTML. */
function extractLoginToken(html: string): string | undefined {
  const match = html.match(/name="logintoken"\s+value="([^"]+)"/);
  return match?.[1];
}

/** Attempt silent re-authentication using stored credentials. Returns session cookie on success, null on failure. */
async function silentReAuth(
  httpClient: HttpClient,
  creds: { username: string; password: string },
  baseUrl: string,
  logger?: Logger,
): Promise<string | null> {
  try {
    // Fetch login page for CSRF token + session cookie
    const loginPage = await httpClient.get(`${baseUrl}/login/index.php`, logger ? { logger } : {});
    const loginToken = extractLoginToken(loginPage.body);
    const sessionCookie = extractCookies(loginPage.headers);

    const body: Record<string, string> = { username: creds.username, password: creds.password };
    if (loginToken) body["logintoken"] = loginToken;

    const response = await httpClient.post(
      `${baseUrl}/login/index.php`,
      body,
      { followRedirects: true, ...(sessionCookie ? { cookie: sessionCookie } : {}), ...(logger ? { logger } : {}) }
    );

    // Same testsession logic as promptAndAuthenticate
    if (response.url.includes("testsession")) {
      const finalCookies = extractCookies(response.headers);
      const myPage = await httpClient.get(`${baseUrl}/my/`, {
        followRedirects: true,
        ...(finalCookies ? { cookie: finalCookies } : {}),
        ...(logger ? { logger } : {}),
      });
      if (!myPage.url.includes("/login/")) return myPage.effectiveCookies || finalCookies || extractCookies(myPage.headers) || "";
      return null;
    }
    if (!response.url.includes("/login/")) return response.effectiveCookies || extractCookies(response.headers);
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate the current session and return a valid session cookie string.
 *
 * Flow:
 *   1. GET /my/ with the existing session cookie — if no redirect to /login/, session is alive.
 *   2. If session has expired, attempt silent re-authentication using stored Keychain credentials
 *      (up to maxRetries attempts). Each attempt replicates the two-step Moodle login
 *      (GET login page → extract CSRF token → POST credentials → verify via /my/).
 *   3. If all re-auth attempts fail, throw AuthError with exitCode AUTH_ERROR.
 *   4. If no credentials are stored and no interactive fallback is provided, throw AuthError.
 */
export async function validateOrRefreshSession(opts: SessionOptions): Promise<string> {
  const {
    httpClient,
    keychain,
    baseUrl = "https://moodle.hwr-berlin.de",
    maxRetries = 3,
    interactivePromptFallback,
    logger,
  } = opts;

  // Validate session with a lightweight GET — a logged-in GET /my/ returns 200 without redirecting to /login/
  const response = await httpClient.get(`${baseUrl}/my/`, { followRedirects: true, ...(logger ? { logger } : {}) });
  if (!response.url.includes("/login/")) return response.effectiveCookies || extractCookies(response.headers); // session valid

  // Session expired — try Keychain credentials
  const creds = keychain ? await keychain.readCredentials() : null;
  if (!creds) {
    if (interactivePromptFallback) {
      await interactivePromptFallback();
      return "";
    }
    throw new AuthError("No credentials stored.", EXIT_CODES.AUTH_ERROR);
  }

  // Silent re-authentication
  logger?.warn("Session expired, re-authenticating…");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const cookie = await silentReAuth(httpClient, creds, baseUrl, logger);
    if (cookie !== null) return cookie;
  }

  throw new AuthError(`Authentication failed after ${maxRetries} attempts.`, EXIT_CODES.AUTH_ERROR);
}
