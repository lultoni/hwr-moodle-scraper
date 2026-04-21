// Provides a module-level "active logger" slot that the global uncaughtException /
// unhandledRejection handlers can use to mirror fatal errors into the log file.
//
// Without this, fatal errors are only written to process.stderr — which is visible
// in the terminal but never captured in the --log-file, making offline diagnosis
// impossible for users who share log files for support.

import type { Logger } from "./logger.js";

let _activeLogger: Logger | null = null;

/** Set the logger that should receive fatal error messages. Call from runScrape()
 *  after createLogger(), and clear on exit with setActiveLogger(null). */
export function setActiveLogger(logger: Logger | null): void {
  _activeLogger = logger;
}

/** Write a fatal error message through the active logger (if set).
 *  Always writes the raw string — caller must pre-format with fatalErrorMessage(). */
export function logFatalError(message: string): void {
  _activeLogger?.error(message);
}
