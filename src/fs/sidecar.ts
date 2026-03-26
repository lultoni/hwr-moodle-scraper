// REQ-FS-007
import { writeFileSync } from "node:fs";

export interface SidecarMeta {
  sourceUrl: string;
  downloadedAt: string;
  sizeBytes: number;
  sha256: string;
  moodleResourceId: string;
  courseName: string;
  sectionName: string;
}

export async function writeSidecar(filePath: string, meta: SidecarMeta): Promise<void> {
  const sidecarPath = filePath + ".meta.json";
  writeFileSync(sidecarPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
}
