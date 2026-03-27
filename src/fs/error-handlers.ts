// REQ-ERR-008, REQ-ERR-011
import { unlinkSync, existsSync } from "node:fs";
import { EXIT_CODES } from "../exit-codes.js";

export async function handleDiskFull(partialPath: string, err: Error): Promise<void> {
  try {
    if (existsSync(partialPath)) unlinkSync(partialPath);
  } catch {
    // best effort
  }
  // Logger is not available in this low-level error handler — write directly to stderr.
  process.stderr.write(`Error: disk full — ${partialPath}: ${err.message}\n`);
}
