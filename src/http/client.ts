// REQ-SEC-003, REQ-SEC-006, REQ-SEC-008
import { request, type Dispatcher } from "undici";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_CODES } from "../exit-codes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve package.json: works both from src/http/ (../../) and from flat dist/ (../)
function readPkg(): { version: string } {
  for (const rel of ["../../package.json", "../package.json"]) {
    try { return JSON.parse(readFileSync(resolve(__dirname, rel), "utf8")) as { version: string }; } catch { /* try next */ }
  }
  return { version: "0.0.0" };
}
const pkg = readPkg();

const USER_AGENT = `moodle-scraper/${pkg.version} (https://github.com/hwr-moodle-scraper)`;

export class InsecureURLError extends Error {
  constructor(url: string) {
    super(`Insecure URL rejected (http:// not allowed): ${url}`);
    this.name = "InsecureURLError";
  }
}

export class MoodleMaintenanceError extends Error {
  readonly exitCode = EXIT_CODES.NETWORK_ERROR;
  constructor() {
    super("Moodle is in maintenance mode. Try again later.");
    this.name = "MoodleMaintenanceError";
  }
}

export interface HttpResponse {
  status: number;
  url: string;
  body: string;
  headers: Record<string, string | string[]>;
}

export interface HttpRequestOptions {
  handleErrors?: boolean;
  retry?: boolean;
  maxRetries?: number;
}

function assertHttps(url: string): void {
  if (url.startsWith("http://")) throw new InsecureURLError(url);
}

function checkMaintenanceMode(html: string, url: string): void {
  if (html.includes("site-maintenance")) {
    throw new MoodleMaintenanceError();
  }
}

export interface HttpClient {
  get(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  post(url: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse>;
}

export function createHttpClient(): HttpClient {
  async function doRequest(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse> {
    assertHttps(url);

    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      "accept": "text/html,application/json,*/*",
    };
    if (body !== undefined) {
      headers["content-type"] = "application/x-www-form-urlencoded";
    }

    const { statusCode, headers: resHeaders, body: resBody } = await request(url, {
      method,
      headers,
      body: body ? new URLSearchParams(body as Record<string, string>).toString() : undefined,
    });

    const text = await resBody.text();
    const contentType = (resHeaders["content-type"] as string | undefined) ?? "";
    if (contentType.includes("text/html")) {
      checkMaintenanceMode(text, url);
    }

    // Handle 403: log and return without throwing (when handleErrors: true)
    if (statusCode === 403 && options.handleErrors) {
      process.stderr.write(`Access denied: ${url}\n`);
    }

    // Handle 429: respect Retry-After then retry
    if (statusCode === 429) {
      const retryAfter = parseInt(resHeaders["retry-after"] as string ?? "1", 10) * 1000;
      await new Promise((r) => setTimeout(r, retryAfter));
      return doRequest(method, url, body, options);
    }

    // Handle 5xx with retry
    if (statusCode >= 500 && options.retry) {
      const maxRetries = options.maxRetries ?? 3;
      process.stderr.write(`HTTP ${statusCode} from ${url}, retrying...\n`);
      if (maxRetries > 1) {
        return doRequest(method, url, body, { ...options, maxRetries: maxRetries - 1 });
      }
      // Exhausted retries — return the error response
    }

    // Resolve final URL (undici doesn't auto-follow redirects by default; handle 3xx)
    const finalUrl = (resHeaders["location"] as string | undefined) ?? url;

    return {
      status: statusCode,
      url: statusCode >= 300 && statusCode < 400 ? finalUrl : url,
      body: text,
      headers: resHeaders as Record<string, string | string[]>,
    };
  }

  return {
    get: (url, opts) => doRequest("GET", url, undefined, opts),
    post: (url, body, opts) => doRequest("POST", url, body, opts),
  };
}
