// REQ-AUTH-001, REQ-AUTH-003, REQ-AUTH-006
import { EXIT_CODES } from "../exit-codes.js";
import type { KeychainAdapter } from "./keychain.js";
import type { HttpClient } from "../http/client.js";
import type { Logger } from "../logger.js";
import { extractCookies } from "../http/cookies.js";

export class AuthError extends Error {
  readonly exitCode: number;
  constructor(msg: string, exitCode: number) {
    super(msg);
    this.exitCode = exitCode;
    this.name = "AuthError";
  }
}

export interface PromptFn {
  (prompt: string, masked?: boolean): Promise<string>;
}

export interface PromptAuthOptions {
  promptFn: PromptFn;
  httpClient: HttpClient;
  keychain?: KeychainAdapter;
  baseUrl?: string;
  logger?: Logger;
}

/** Extract the logintoken CSRF field from Moodle's login page HTML. */
function extractLoginToken(html: string): string | undefined {
  const match = html.match(/name="logintoken"\s+value="([^"]+)"/);
  return match?.[1];
}

/**
 * Prompt the user for credentials and perform a two-step Moodle login.
 *
 * Moodle login flow:
 *   1. GET /login/index.php — obtain CSRF logintoken and establish pre-login session cookie
 *   2. POST /login/index.php with credentials + logintoken (send pre-login cookie too)
 *   3. On success, Moodle redirects to ?testsession=N — a confirmation page, NOT the dashboard
 *   4. Verify login by GETting /my/ with the accumulated cookies:
 *      - If /my/ loads without redirecting to /login/ → authenticated
 *      - If redirected to /login/ → credentials incorrect
 *
 * On success, credentials are stored in the macOS Keychain via the provided adapter.
 */
export async function promptAndAuthenticate(opts: PromptAuthOptions): Promise<void> {
  const { promptFn, httpClient, keychain, baseUrl = "https://moodle.hwr-berlin.de", logger } = opts;

  // Collect username (re-prompt on empty)
  let username = "";
  while (!username.trim()) {
    username = await promptFn("Username: ");
    if (!username.trim()) {
      process.stderr.write("Username must not be empty.\n");
      username = "";
    }
  }
  logger?.debug(`[auth] username entered: "${username}"`);

  // Collect password (re-prompt on empty)
  let password = "";
  while (!password) {
    password = await promptFn("Password: ", true);
    if (!password) {
      process.stderr.write("Password must not be empty.\n");
    }
  }
  logger?.debug(`[auth] password entered: ${password.length} characters`);

  // Fetch login page to obtain the CSRF logintoken AND the session cookie.
  // Moodle validates the logintoken against the session established by this GET,
  // so we must send the session cookie back with the POST.
  let loginToken: string | undefined;
  let sessionCookie = "";
  try {
    logger?.debug(`[auth] fetching login page: ${baseUrl}/login/index.php`);
    const loginPage = await httpClient.get(`${baseUrl}/login/index.php`, { logger });
    loginToken = extractLoginToken(loginPage.body);
    sessionCookie = extractCookies(loginPage.headers);
    logger?.debug(`[auth] loginToken: ${loginToken ?? "(none)"}`);
    logger?.debug(`[auth] sessionCookie: ${sessionCookie || "(none)"}`);
  } catch (err) {
    logger?.debug(`[auth] login page fetch failed: ${(err as Error).message} — proceeding without token/cookie`);
    // Non-fatal: proceed without token/cookie (will likely fail but not crash)
  }

  // Attempt login
  let response: { status: number; url: string; body: string; headers: Record<string, string | string[]> };
  try {
    const body: Record<string, string> = { username, password };
    if (loginToken) body["logintoken"] = loginToken;
    logger?.debug(`[auth] POSTing to ${baseUrl}/login/index.php (logintoken=${loginToken ?? "none"}, cookie=${sessionCookie || "none"})`);
    response = await httpClient.post(
      `${baseUrl}/login/index.php`,
      body,
      { followRedirects: true, cookie: sessionCookie || undefined, logger }
    ) as typeof response;
    logger?.debug(`[auth] final response URL: ${response.url}`);
  } catch (err) {
    const msg = `Login failed: network error — ${(err as Error).message}.`;
    process.stderr.write(msg + "\n");
    throw new AuthError(msg, EXIT_CODES.ERROR);
  }

  // Detect login failure.
  // Success path: POST → ?testsession=N (200, login page but session established) → need to verify by hitting /my/
  // Failure path: POST → ?loginredirect=1 (200, login page with error)
  // After following all redirects, check whether we can actually reach /my/ with the accumulated session.
  let isLoggedIn = false;
  if (response.url.includes("testsession")) {
    // Session established — verify by fetching /my/ with the cookies from the final response
    try {
      const finalCookies = extractCookies(response.headers);
      logger?.debug(`[auth] testsession detected — verifying via ${baseUrl}/my/ with cookie: ${finalCookies}`);
      const myPage = await httpClient.get(`${baseUrl}/my/`, {
        followRedirects: true,
        cookie: finalCookies || undefined,
        logger,
      });
      logger?.debug(`[auth] /my/ final URL: ${myPage.url}`);
      isLoggedIn = !myPage.url.includes("/login/");
    } catch (err) {
      logger?.debug(`[auth] /my/ check failed: ${(err as Error).message}`);
    }
  } else {
    // No testsession step — final URL not on /login/ means success
    isLoggedIn = !response.url.includes("/login/");
  }

  if (!isLoggedIn) {
    const msg = "Login failed: incorrect username or password.";
    process.stderr.write(msg + "\n");
    throw new AuthError(msg, EXIT_CODES.ERROR);
  }

  // Store credentials — only on success
  if (keychain) {
    await keychain.storeCredentials(username, password);
  }
}
