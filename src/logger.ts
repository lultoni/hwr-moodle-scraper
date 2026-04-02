// REQ-SEC-002, REQ-SEC-007
import { appendFileSync, openSync, closeSync, chmodSync } from "node:fs";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LoggerOptions {
  level: LogLevel;
  /** Strings to redact from all log output (e.g. passwords, session tokens). Pass all known secrets here. */
  redact: string[];
  logFile?: string | null;
  /**
   * Whether to include ISO timestamps in stderr output.
   * Defaults to `true` when `logFile` is set (timestamps are important for log file diagnostics),
   * `false` otherwise (cleaner terminal output).
   */
  timestamps?: boolean;
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

function redactSecrets(msg: string, secrets: string[]): string {
  let out = msg;
  for (const s of secrets) {
    if (s) out = out.split(s).join("[REDACTED]");
  }
  return out;
}

function ensureLogFile(path: string): void {
  try {
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
  } catch {
    // ignore — file may already exist and be writable
  }
}

export function createLogger(opts: LoggerOptions): Logger {
  const { level, redact, logFile } = opts;
  // Default: show timestamps when logFile is active (useful for diagnosis),
  // suppress in plain terminal output.
  const showTimestamps = opts.timestamps ?? (logFile != null);

  if (logFile) ensureLogFile(logFile);

  function emit(msgLevel: LogLevel, msg: string): void {
    if (msgLevel < level) return;
    const safe = redactSecrets(msg, redact);
    const prefix = LogLevel[msgLevel] ?? "LOG";
    const ts = new Date().toISOString();
    const line = showTimestamps ? `[${ts}] [${prefix}] ${safe}\n` : `[${prefix}] ${safe}\n`;
    process.stderr.write(line);
    if (logFile) {
      // Log file always gets timestamps for diagnostic value
      const fileLine = showTimestamps ? line : `[${ts}] [${prefix}] ${safe}\n`;
      appendFileSync(logFile, fileLine);
    }
  }

  return {
    debug: (msg) => emit(LogLevel.DEBUG, msg),
    info:  (msg) => emit(LogLevel.INFO, msg),
    warn:  (msg) => emit(LogLevel.WARN, msg),
    error: (msg) => emit(LogLevel.ERROR, msg),
  };
}

export function assertNoSecrets(obj: unknown, secrets: string[]): void {
  const json = JSON.stringify(obj);
  for (const s of secrets) {
    if (s && json.includes(s)) {
      throw new Error(`State object contains a secret value`);
    }
  }
}
