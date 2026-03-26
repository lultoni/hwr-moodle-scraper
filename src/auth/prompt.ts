// REQ-AUTH-001, REQ-AUTH-003, REQ-AUTH-006
import { EXIT_CODES } from "../exit-codes.js";
import type { KeychainAdapter } from "./keychain.js";
import type { HttpClient } from "../http/client.js";

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
}

/** Extract the logintoken CSRF field from Moodle's login page HTML. */
function extractLoginToken(html: string): string | undefined {
  const match = html.match(/name="logintoken"\s+value="([^"]+)"/);
  return match?.[1];
}

export async function promptAndAuthenticate(opts: PromptAuthOptions): Promise<void> {
  const { promptFn, httpClient, keychain, baseUrl = "https://moodle.hwr-berlin.de" } = opts;

  // Collect username (re-prompt on empty)
  let username = "";
  while (!username.trim()) {
    username = await promptFn("Username: ");
    if (!username.trim()) {
      process.stderr.write("Username must not be empty.\n");
      username = "";
    }
  }

  // Collect password (re-prompt on empty)
  let password = "";
  while (!password) {
    password = await promptFn("Password: ", true);
    if (!password) {
      process.stderr.write("Password must not be empty.\n");
    }
  }

  // Fetch login page to obtain the CSRF logintoken
  let loginToken: string | undefined;
  try {
    const loginPage = await httpClient.get(`${baseUrl}/login/index.php`);
    loginToken = extractLoginToken(loginPage.body);
  } catch {
    // Non-fatal: proceed without token (some Moodle versions don't require it)
  }

  // Attempt login
  let response: { status: number; url: string };
  try {
    const body: Record<string, string> = { username, password };
    if (loginToken) body["logintoken"] = loginToken;
    response = await httpClient.post(`${baseUrl}/login/index.php`, body) as typeof response;
  } catch (err) {
    const msg = `Login failed: network error — ${(err as Error).message}.`;
    process.stderr.write(msg + "\n");
    throw new AuthError(msg, EXIT_CODES.ERROR);
  }

  // Detect login failure: response URL still points to /login/
  if (response.url.includes("/login/")) {
    const msg = "Login failed: incorrect username or password.";
    process.stderr.write(msg + "\n");
    throw new AuthError(msg, EXIT_CODES.ERROR);
  }

  // Store credentials — only on success
  if (keychain) {
    await keychain.storeCredentials(username, password);
  }
}

