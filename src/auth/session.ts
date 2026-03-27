// REQ-AUTH-004, REQ-AUTH-005
import { EXIT_CODES } from "../exit-codes.js";
import type { KeychainAdapter } from "./keychain.js";
import type { HttpClient } from "../http/client.js";
import { AuthError } from "./prompt.js";
import type { Logger } from "../logger.js";

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
  logger?: Logger;
}

/** Extract session cookie string from Set-Cookie headers. */
function extractCookies(headers: Record<string, string | string[]>): string {
  const raw = headers["set-cookie"];
  if (!raw) return "";
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => c.split(";")[0]).join("; ");
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
      { followRedirects: true, cookie: sessionCookie || undefined, ...(logger ? { logger } : {}) }
    );

    // Same testsession logic as promptAndAuthenticate
    if (response.url.includes("testsession")) {
      const finalCookies = extractCookies(response.headers);
      const myPage = await httpClient.get(`${baseUrl}/my/`, {
        followRedirects: true,
        cookie: finalCookies || undefined,
        ...(logger ? { logger } : {}),
      });
      if (!myPage.url.includes("/login/")) return extractCookies(myPage.headers) || finalCookies;
      return null;
    }
    if (!response.url.includes("/login/")) return extractCookies(response.headers);
    return null;
  } catch {
    return null;
  }
}

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
  if (!response.url.includes("/login/")) return extractCookies(response.headers); // session valid

  // Session expired — try Keychain credentials
  const creds = await keychain.readCredentials();
  if (!creds) {
    if (interactivePromptFallback) {
      await interactivePromptFallback();
      return "";
    }
    throw new AuthError("No credentials stored.", EXIT_CODES.AUTH_ERROR);
  }

  // Silent re-authentication
  process.stderr.write("Session expired, re-authenticating…\n");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const cookie = await silentReAuth(httpClient, creds, baseUrl, logger);
    if (cookie !== null) return cookie;
  }

  throw Object.assign(
    new Error(`Authentication failed after ${maxRetries} attempts.`),
    { exitCode: EXIT_CODES.AUTH_ERROR }
  );
}
