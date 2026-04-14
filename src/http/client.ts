// REQ-SEC-003, REQ-SEC-006, REQ-SEC-008
import { request, type Dispatcher } from "undici";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_CODES } from "../exit-codes.js";
import type { Logger } from "../logger.js";
import { extractCookies } from "./cookies.js";
import { isSameOrigin, sanitiseUrlForLog } from "./url-guard.js";

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
    super(`Non-HTTPS URL rejected: ${sanitiseUrlForLog(url)}`);
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
  /** Timeout for receiving response headers (ms). Default 30 000. */
  headersTimeout?: number;
  /** Timeout for receiving the full response body (ms). Default 120 000. */
  bodyTimeout?: number;
}

function assertHttps(url: string): void {
  if (!url.startsWith("https://")) throw new InsecureURLError(url);
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

const MAX_429_RETRIES = 3;
const MAX_RETRY_AFTER_SEC = 300;

export function createHttpClient(): HttpClient {
  async function doRequest(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
    options: HttpRequestOptions = {},
    _sentCookies?: string,
    _retryCount429 = 0,
  ): Promise<HttpResponse> {
    assertHttps(url);
    const { logger } = options;

    logger?.debug(`→ ${method} ${url}`);
    if (options.cookie) {
      logger?.addSecret(options.cookie); // ensure cookie values are always redacted
      logger?.debug(`  Cookie: ${options.cookie}`);
    }

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
      headersTimeout: options.headersTimeout ?? 30_000,
      bodyTimeout: options.bodyTimeout ?? 120_000,
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

    // Handle 429: respect Retry-After then retry (bounded)
    if (statusCode === 429) {
      if (_retryCount429 >= MAX_429_RETRIES) {
        logger?.warn(`429 rate-limited ${MAX_429_RETRIES} times for ${url} — giving up`);
        // Fall through to return the 429 response
      } else {
        const rawRetryAfter = parseInt(resHeaders["retry-after"] as string ?? "1", 10);
        const retryAfterSec = Number.isFinite(rawRetryAfter)
          ? Math.min(Math.max(rawRetryAfter, 1), MAX_RETRY_AFTER_SEC)
          : 1;
        logger?.debug(`429 from ${url}, retrying after ${retryAfterSec}s (attempt ${_retryCount429 + 1}/${MAX_429_RETRIES})`);
        await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
        return doRequest(method, url, body, options, _sentCookies, _retryCount429 + 1);
      }
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
        // SSRF defense: strip session cookies when redirecting to an external domain
        const crossDomain = !isSameOrigin(absoluteLocation, url);
        if (crossDomain && mergedCookie) {
          logger?.debug(`  ↪ redirect → ${absoluteLocation} (external — cookies stripped)`);
        } else {
          logger?.debug(`  ↪ redirect → ${absoluteLocation}`);
        }
        return doRequest("GET", absoluteLocation, undefined, {
          ...options,
          ...(crossDomain ? {} : mergedCookie ? { cookie: mergedCookie } : {}),
          maxRedirects: maxRedirects - 1,
        }, crossDomain ? undefined : mergedCookie || undefined);
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
