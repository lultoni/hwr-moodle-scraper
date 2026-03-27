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

  if (logFile) ensureLogFile(logFile);

  function emit(msgLevel: LogLevel, msg: string): void {
    if (msgLevel < level) return;
    const safe = redactSecrets(msg, redact);
    const prefix = LogLevel[msgLevel] ?? "LOG";
    const ts = new Date().toISOString();
    const line = `[${ts}] [${prefix}] ${safe}\n`;
    process.stderr.write(line);
    if (logFile) {
      appendFileSync(logFile, line);
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
