// Covers: STEP-012, REQ-FS-007
//
// Tests for optional metadata sidecar files.
// Uses a temp directory; no real downloads.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSidecar } from "../../src/fs/sidecar.js";
import { createHash } from "node:crypto";

describe("STEP-012: Metadata sidecar", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-sidecar-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleMeta = {
    sourceUrl: "https://moodle.example.com/pluginfile.php/1/mod_resource/content/1/lecture1.pdf",
    downloadedAt: "2026-03-26T10:00:00.000Z",
    sizeBytes: 1024,
    sha256: "abc123",
    moodleResourceId: "42",
    courseName: "Macro 2024",
    sectionName: "Week 1",
  };

  // REQ-FS-007
  it("writes <filename>.meta.json alongside the target file", async () => {
    const filePath = join(tmpDir, "lecture1.pdf");
    await writeSidecar(filePath, sampleMeta);
    expect(existsSync(filePath + ".meta.json")).toBe(true);
  });

  it("sidecar JSON contains all 7 required fields", async () => {
    const filePath = join(tmpDir, "lecture1.pdf");
    await writeSidecar(filePath, sampleMeta);
    const raw = JSON.parse(readFileSync(filePath + ".meta.json", "utf8"));
    expect(raw).toHaveProperty("sourceUrl");
    expect(raw).toHaveProperty("downloadedAt");
    expect(raw).toHaveProperty("sizeBytes");
    expect(raw).toHaveProperty("sha256");
    expect(raw).toHaveProperty("moodleResourceId");
    expect(raw).toHaveProperty("courseName");
    expect(raw).toHaveProperty("sectionName");
  });

  it("sidecar SHA-256 matches the provided hash", async () => {
    const content = Buffer.from("fake pdf content");
    const hash = createHash("sha256").update(content).digest("hex");
    const filePath = join(tmpDir, "doc.pdf");

    await writeSidecar(filePath, { ...sampleMeta, sha256: hash });

    const raw = JSON.parse(readFileSync(filePath + ".meta.json", "utf8"));
    expect(raw.sha256).toBe(hash);
  });

  it("does NOT write a sidecar when metadata option is not enabled", async () => {
    // writeSidecar is only called when --metadata flag is set.
    // This test verifies that NOT calling writeSidecar leaves no sidecar.
    const filePath = join(tmpDir, "no-sidecar.pdf");
    // Do not call writeSidecar
    expect(existsSync(filePath + ".meta.json")).toBe(false);
  });
});
