// Maps known German Moodle error strings to English equivalents.
// When Moodle returns a German error message, translateMoodleError wraps it
// with an English explanation so non-German users can understand the problem.

const MOODLE_ERRORS: Array<[RegExp, string]> = [
  [/ungültige anmeldedaten/i, "Invalid credentials (wrong username or password)"],
  [/sitzung abgelaufen/i, "Session expired — please log in again"],
  [/keine berechtigung/i, "Access denied"],
  [/datei nicht gefunden/i, "File not found"],
  [/wartungsmodus/i, "Moodle is in maintenance mode"],
  [/anmeldung fehlgeschlagen/i, "Login failed"],
  [/zugriff verweigert/i, "Access denied"],
  [/nicht angemeldet/i, "Not logged in — session may have expired"],
];

/**
 * Wrap a raw Moodle error string with an English translation if a known
 * German pattern is detected.
 *
 * Returns: `"English translation (Moodle: \"<raw>\")"` when a match is found,
 * or the original string unchanged when no match.
 */
export function translateMoodleError(raw: string): string {
  const trimmed = raw.trim();
  for (const [pattern, english] of MOODLE_ERRORS) {
    if (pattern.test(trimmed)) {
      return `${english} (Moodle: "${trimmed}")`;
    }
  }
  return trimmed;
}
