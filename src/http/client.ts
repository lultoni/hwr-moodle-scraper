// REQ-SEC-003, REQ-SEC-006, REQ-SEC-008
import { request, type Dispatcher } from "undici";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_CODES } from "../exit-codes.js";
import type { Logger } from "../logger.js";
import { extractCookies } from "./cookies.js";

// Resolve version: prefer build-time env injection, fall back to package.json discovery
const VERSION = process.env.npm_package_version ?? (() => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../../package.json", "../package.json"]) {
    try { return (JSON.parse(readFileSync(resolve(__dirname, rel), "utf8")) as { version: string }).version; } catch { /* try next */ }
  }
  return "0.0.0";
})();

const USER_AGENT = `moodle-scraper/${VERSION} (https://github.com/hwr-moodle-scraper)`;

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
  /** The cookie string that was sent on the final request (includes cookies accumulated through redirects). */
  effectiveCookies?: string;
}

export interface HttpRequestOptions {
  handleErrors?: boolean;
  retry?: boolean;
  maxRetries?: number;
  cookie?: string;
  followRedirects?: boolean;
  maxRedirects?: number;
  logger?: Logger;
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

/** Merge two cookie strings, with later values overriding earlier ones for the same name. */
function mergeCookies(existing: string, incoming: string): string {
  const map = new Map<string, string>();
  for (const part of [existing, incoming]) {
    for (const pair of part.split(";").map((s) => s.trim()).filter(Boolean)) {
      const eq = pair.indexOf("=");
      const name = eq >= 0 ? pair.slice(0, eq).trim() : pair;
      map.set(name, pair);
    }
  }
  return Array.from(map.values()).join("; ");
}

export function createHttpClient(): HttpClient {
  async function doRequest(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
    options: HttpRequestOptions = {},
    _sentCookies?: string,
  ): Promise<HttpResponse> {
    assertHttps(url);
    const { logger } = options;

    logger?.debug(`→ ${method} ${url}`);
    if (options.cookie) logger?.debug(`  Cookie: ${options.cookie}`);

    const sentCookies = _sentCookies ?? options.cookie ?? "";

    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      "accept": "text/html,application/json,*/*",
    };
    if (body !== undefined) {
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    if (options.cookie) {
      headers["cookie"] = options.cookie;
    }

    const { statusCode, headers: resHeaders, body: resBody } = await request(url, {
      method,
      headers,
      ...(body ? { body: new URLSearchParams(body as Record<string, string>).toString() } : {}),
    });

    const text = await resBody.text();
    logger?.debug(`  ← ${statusCode} (${text.length} bytes)`);

    const contentType = (resHeaders["content-type"] as string | undefined) ?? "";
    if (contentType.includes("text/html")) {
      checkMaintenanceMode(text, url);
    }

    // Handle 403: log and return without throwing (when handleErrors: true)
    if (statusCode === 403 && options.handleErrors) {
      logger?.warn(`Access denied: ${url}`);
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
      logger?.warn(`HTTP ${statusCode} from ${url}, retrying...`);
      if (maxRetries > 1) {
        return doRequest(method, url, body, { ...options, maxRetries: maxRetries - 1 });
      }
      // Exhausted retries — return the error response
    }

    // Resolve final URL (undici doesn't auto-follow redirects by default; handle 3xx)
    const location = (resHeaders["location"] as string | undefined);
    const finalUrl = location ?? url;

    // Collect any new session cookies from this response
    const newCookies = extractCookies(resHeaders as Record<string, string | string[]>);

    // Follow redirects if requested
    if (statusCode >= 300 && statusCode < 400 && options.followRedirects && location) {
      const maxRedirects = options.maxRedirects ?? 5;
      if (maxRedirects > 0) {
        // Resolve relative Location headers against the request URL
        const absoluteLocation = location.startsWith("http")
          ? location
          : new URL(location, url).toString();
        // Merge cookies: incoming Set-Cookie values override same-named existing cookies
        const mergedCookie = newCookies
          ? mergeCookies(options.cookie ?? "", newCookies)
          : options.cookie;
        logger?.debug(`  ↪ redirect → ${absoluteLocation}`);
        return doRequest("GET", absoluteLocation, undefined, {
          ...options,
          ...(mergedCookie ? { cookie: mergedCookie } : {}),
          maxRedirects: maxRedirects - 1,
        }, mergedCookie || undefined);
      }
    }

    return {
      status: statusCode,
      url: statusCode >= 300 && statusCode < 400 ? finalUrl : url,
      body: text,
      headers: resHeaders as Record<string, string | string[]>,
      ...(sentCookies ? { effectiveCookies: sentCookies } : {}),
    };
  }

  return {
    get: (url, opts) => doRequest("GET", url, undefined, opts),
    post: (url, body, opts) => doRequest("POST", url, body, opts),
  };
}
