/**
 * TUI options registry — single source of truth for scrape boolean toggles.
 *
 * When a new boolean flag is added to ScrapeOptions, add it here and it will
 * automatically appear in the TUI scrape screen's options list.
 */

import type { ScrapeOptions } from "../commands/scrape.js";

export interface BooleanOption {
  /** Key in ScrapeOptions (compile-time checked via the type constraint below) */
  key: Extract<keyof ScrapeOptions, string>;
  /** Label shown in the TUI toggle row */
  label: string;
  /** Default value */
  default: boolean;
  /** Keys that get reset to false when this option is toggled on */
  mutuallyExclusive?: string[];
}

export const SCRAPE_BOOL_OPTIONS: BooleanOption[] = [
  { key: "verbose",       label: "Verbose output",            default: false, mutuallyExclusive: ["quiet"] },
  { key: "quiet",         label: "Quiet (errors only)",       default: false, mutuallyExclusive: ["verbose"] },
  { key: "skipDiskCheck", label: "Skip disk space check",     default: false },
  { key: "metadata",      label: "Write .meta.json sidecars", default: false },
];
