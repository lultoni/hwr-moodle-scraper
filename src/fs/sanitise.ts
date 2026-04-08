// REQ-FS-003, REQ-FS-004
// UK English spelling used throughout this file (sanitise, not sanitize).
const ILLEGAL = /[/\\:*?"<>|]/g;
const NULL_BYTE = /\x00/g;
const MAX_BYTES = 255;

export function sanitiseFilename(name: string): string {
  // Remove null bytes first (they must disappear, not become _)
  let s = name.replace(NULL_BYTE, "");
  // Decode common HTML entities to their character equivalents
  // (Moodle double-encodes some attributes, leaving residual entities after the main decode pass)
  s = s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/gi, (_, d: string) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
  // Replace remaining illegal characters with _
  s = s.replace(ILLEGAL, "_");
  // Trim leading/trailing whitespace and dots
  s = s.replace(/^[\s.]+|[\s.]+$/g, "");
  // After replacement, if the result is empty or all underscores from illegal chars, return 'unnamed'
  if (!s || /^_+$/.test(s)) return "unnamed";

  // Truncate to MAX_BYTES (UTF-8), preserving extension
  const dotIdx = s.lastIndexOf(".");
  const hasExt = dotIdx > 0;
  const ext = hasExt ? s.slice(dotIdx) : "";
  const base = hasExt ? s.slice(0, dotIdx) : s;

  if (Buffer.byteLength(s, "utf8") > MAX_BYTES) {
    const extBytes = Buffer.byteLength(ext, "utf8");
    const maxBase = MAX_BYTES - extBytes;
    // Truncate base to maxBase bytes
    const baseBuf = Buffer.from(base, "utf8").slice(0, maxBase);
    s = baseBuf.toString("utf8") + ext;
  }

  return s || "unnamed";
}

export function resolveCollision(filename: string, existing: Set<string>): string {
  if (!existing.has(filename)) return filename;

  const dotIdx = filename.lastIndexOf(".");
  const hasExt = dotIdx > 0;
  const ext = hasExt ? filename.slice(dotIdx) : "";
  const base = hasExt ? filename.slice(0, dotIdx) : filename;

  let n = 2;
  while (true) {
    const candidate = `${base}_${n}${ext}`;
    if (!existing.has(candidate)) return candidate;
    n++;
  }
}
