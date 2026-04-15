// REQ-CLI-011 — Non-blocking GitHub release check
// Fires as fire-and-forget at command start; result awaited after command completes.
// Uses Node.js built-in fetch (available since Node 18, required ≥ Node 20).
// Never throws — all errors are swallowed and return null.

const RELEASES_URL = "https://api.github.com/repos/lultoni/hwr-moodle-scraper/releases/latest";
const TIMEOUT_MS = 5000;

/**
 * Parse a semver string like "v1.2.3" or "1.2.3" into numeric tuple [major, minor, patch].
 * Returns null if the string cannot be parsed.
 */
export function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

/**
 * Compare two semver tuples. Returns true when `candidate` is strictly newer than `current`.
 */
export function isNewer(current: [number, number, number], candidate: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (candidate[i]! > current[i]!) return true;
    if (candidate[i]! < current[i]!) return false;
  }
  return false;
}

/**
 * Determine whether an update check should run based on the last check time and interval.
 *
 * @param lastCheckMs  Unix timestamp (ms) of the last successful check. 0 = never checked.
 * @param intervalHours  Minimum hours between checks. 0 = always check.
 */
export function shouldCheck(lastCheckMs: number, intervalHours: number): boolean {
  if (intervalHours === 0) return true;
  return Date.now() - lastCheckMs >= intervalHours * 3_600_000;
}

/**
 * Check GitHub Releases for a version newer than `currentVersion`.
 * Returns the newer version string (without leading "v") if one is found, null otherwise.
 * Always resolves — never rejects.
 */
export async function checkForUpdate(currentVersion: string): Promise<string | null> {
  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const res = await fetch(RELEASES_URL, {
      headers: { "Accept": "application/vnd.github+json", "User-Agent": `moodle-scraper/${currentVersion}` },
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as { tag_name?: string };
    const tag = data?.tag_name;
    if (typeof tag !== "string") return null;

    const current = parseSemver(currentVersion);
    const latest = parseSemver(tag);
    if (!current || !latest) return null;

    return isNewer(current, latest) ? tag.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}
