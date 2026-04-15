// REQ-CLI-007, REQ-FS-001
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULTS = {
  get outputDir() { return ""; },
  courseSearch: "" as string,
  minFreeDiskMb: 1000,
  maxConcurrentDownloads: 3,
  requestDelayMs: 500,
  requestJitterMs: 200,
  retryBaseDelayMs: 5000,
  logFile: null as string | null,
  /** Set to true after the one-time log-file hint has been shown. */
  logHintShown: false as boolean,
  /** Set to false to suppress the GitHub update-available notification. */
  checkUpdates: true as boolean,
  /** Hours between automatic update checks. 0 = check every run. Default 24h. */
  updateCheckIntervalHours: 24 as number,
  /** Unix timestamp (ms) of the last update check. Internal — not user-editable. */
  lastUpdateCheckMs: 0 as number,
} as const;

export type ConfigKey = keyof typeof DEFAULTS;
export type ConfigValue = string | number | boolean | null;

/**
 * Config keys shown to users in the TUI config editor and `msc config list`.
 * Excludes internal flags (logHintShown) that users should not edit directly.
 */
export const USER_EDITABLE_KEYS: ConfigKey[] = [
  "outputDir",
  "courseSearch",
  "minFreeDiskMb",
  "maxConcurrentDownloads",
  "requestDelayMs",
  "requestJitterMs",
  "retryBaseDelayMs",
  "logFile",
  "checkUpdates",
  "updateCheckIntervalHours",
];

const VALIDATION: Partial<Record<ConfigKey, { min: number; max: number }>> = {
  requestDelayMs:             { min: 100,  max: 30_000 },
  requestJitterMs:            { min: 0,    max: 10_000 },
  maxConcurrentDownloads:     { min: 1,    max: 20 },
  minFreeDiskMb:              { min: 50,   max: 100_000 },
  retryBaseDelayMs:           { min: 500,  max: 60_000 },
  updateCheckIntervalHours:   { min: 0,    max: 8_760 },
};

export class ConfigManager {
  private readonly configDir: string;
  private readonly configFile: string;

  constructor(configDir?: string) {
    this.configDir = configDir ?? join(homedir(), ".config", "moodle-scraper");
    this.configFile = join(this.configDir, "config.json");
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    }
  }

  private read(): Record<string, ConfigValue> {
    if (!existsSync(this.configFile)) return {};
    try {
      return JSON.parse(readFileSync(this.configFile, "utf8")) as Record<string, ConfigValue>;
    } catch {
      process.stderr.write(`Warning: config file at ${this.configFile} is corrupt — using defaults.\n`);
      return {};
    }
  }

  private write(data: Record<string, ConfigValue>): void {
    const json = JSON.stringify(data, null, 2);
    writeFileSync(this.configFile, json, { mode: 0o600 });
  }

  async get<K extends ConfigKey>(key: K): Promise<(typeof DEFAULTS)[K] | undefined> {
    const stored = this.read();
    if (key in stored) return stored[key] as (typeof DEFAULTS)[K];
    return DEFAULTS[key];
  }

  async set(key: ConfigKey, value: ConfigValue): Promise<void> {
    const range = VALIDATION[key];
    if (range && typeof value === "number") {
      if (value < range.min || value > range.max) {
        throw new RangeError(`Config '${key}' must be between ${range.min} and ${range.max}, got ${value}`);
      }
    }
    const data = this.read();
    data[key] = value;
    this.write(data);
  }

  async list(): Promise<Record<string, ConfigValue>> {
    const stored = this.read();
    return { ...DEFAULTS, ...stored } as Record<string, ConfigValue>;
  }

  async reset(): Promise<void> {
    this.write({});
  }
}
