// REQ-SEC-002, REQ-SEC-007
import { appendFileSync, openSync, closeSync, chmodSync, statSync, renameSync } from "node:fs";

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
  /** Maximum log file size in MB before rotation. Default 50. */
  maxLogFileSizeMb?: number;
  /**
   * Minimum log level written to the log file.
   * Defaults to `LogLevel.DEBUG` when `logFile` is set, giving full diagnostic output
   * regardless of the stderr level. Set explicitly to restrict file output.
   */
  fileLevel?: LogLevel;
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  /** Register a secret discovered after logger creation (e.g. password from keychain). */
  addSecret(secret: string): void;
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
  const { level, logFile } = opts;
  const secrets = [...opts.redact]; // mutable copy for addSecret()
  const maxLogFileBytes = (opts.maxLogFileSizeMb ?? 50) * 1024 * 1024;
  // Default: show timestamps when logFile is active (useful for diagnosis),
  // suppress in plain terminal output.
  const showTimestamps = opts.timestamps ?? (logFile != null);
  // Default file level: DEBUG when logFile is set (full diagnostics), otherwise same as stderr level.
  const fileLevelThreshold = opts.fileLevel ?? (logFile != null ? LogLevel.DEBUG : level);

  // Color support: only when stderr is a TTY and NO_COLOR is unset
  const USE_COLOR = process.stderr.isTTY && !process.env["NO_COLOR"];
  const C = {
    dim:    USE_COLOR ? "\u001b[2m"  : "",
    yellow: USE_COLOR ? "\u001b[33m" : "",
    red:    USE_COLOR ? "\u001b[31m" : "",
    reset:  USE_COLOR ? "\u001b[0m"  : "",
  };

  const LEVEL_COLOR: Record<number, string> = {
    [LogLevel.DEBUG]: C.dim,
    [LogLevel.INFO]:  C.dim,
    [LogLevel.WARN]:  C.yellow,
    [LogLevel.ERROR]: C.red,
  };

  if (logFile) ensureLogFile(logFile);

  function rotateIfNeeded(): void {
    if (!logFile) return;
    try {
      const stats = statSync(logFile);
      if (stats.size > maxLogFileBytes) {
        renameSync(logFile, logFile + ".1");
        ensureLogFile(logFile);
      }
    } catch {
      // File may not exist yet — that's fine
    }
  }

  function emit(msgLevel: LogLevel, msg: string): void {
    const writesToStderr = msgLevel >= level;
    const writesToFile = logFile != null && msgLevel >= fileLevelThreshold;
    if (!writesToStderr && !writesToFile) return;
    const safe = redactSecrets(msg, secrets);
    const prefix = LogLevel[msgLevel] ?? "LOG";
    const ts = new Date().toISOString();
    if (writesToStderr) {
      const col = LEVEL_COLOR[msgLevel] ?? "";
      const coloredPrefix = USE_COLOR ? `${col}[${prefix}]${C.reset}` : `[${prefix}]`;
      const line = showTimestamps
        ? `[${ts}] ${coloredPrefix} ${safe}\n`
        : `${coloredPrefix} ${safe}\n`;
      process.stderr.write(line);
    }
    if (writesToFile) {
      rotateIfNeeded();
      // Log file always gets plain text (no ANSI) + timestamps for diagnostic value
      const fileLine = `[${ts}] [${prefix}] ${safe}\n`;
      appendFileSync(logFile, fileLine);
    }
  }

  return {
    debug: (msg) => emit(LogLevel.DEBUG, msg),
    info:  (msg) => emit(LogLevel.INFO, msg),
    warn:  (msg) => emit(LogLevel.WARN, msg),
    error: (msg) => emit(LogLevel.ERROR, msg),
    addSecret: (s) => { if (s) secrets.push(s); },
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
