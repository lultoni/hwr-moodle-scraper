// REQ-SYNC-001, REQ-SYNC-002, REQ-SEC-007
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { renameSync } from "node:fs";

export interface FileState {
  name: string;
  url: string;
  localPath: string;
  hash: string;
  lastModified: string;
  status: "ok" | "orphan" | "error";
}

export interface SectionState {
  files: Record<string, FileState>;
}

export interface CourseState {
  name: string;
  sections: Record<string, SectionState>;
}

export interface State {
  version: number;
  lastSyncAt: string;
  courses: Record<string, CourseState>;
}

export type PartialState = { courses: Record<string, Partial<CourseState>> };

export class StateManager {
  readonly statePath: string;

  constructor(outputDir: string) {
    this.statePath = join(outputDir, ".moodle-scraper-state.json");
  }

  async load(): Promise<State | null> {
    if (!existsSync(this.statePath)) return null;
    try {
      const raw = readFileSync(this.statePath, "utf8");
      return JSON.parse(raw) as State;
    } catch {
      process.stderr.write("Warning: state file corrupt — starting fresh sync.\n");
      return null;
    }
  }

  async save(data: PartialState): Promise<void> {
    const state: State = {
      version: 1,
      lastSyncAt: new Date().toISOString(),
      courses: data.courses as Record<string, CourseState>,
    };
    mkdirSync(join(this.statePath, ".."), { recursive: true });
    const tmpPath = this.statePath + "." + randomBytes(4).toString("hex") + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    renameSync(tmpPath, this.statePath);
  }
}
