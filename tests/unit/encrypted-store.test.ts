// Covers: T-6 — Linux/non-macOS credential persistence via encrypted file
//
// Tests for EncryptedFileAdapter and tryCreateCredentialStore.
// Uses real crypto operations (Node.js crypto module) with a temp directory.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedFileAdapter, getMachineId } from "../../src/auth/encrypted-store.js";

describe("T-6: EncryptedFileAdapter", () => {
  let tmpDir: string;
  let adapter: EncryptedFileAdapter;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "msc-enc-test-"));
    adapter = new EncryptedFileAdapter(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("storeCredentials writes an encrypted file to configDir", async () => {
    await adapter.storeCredentials("alice", "s3cr3t");
    expect(existsSync(join(tmpDir, "credentials.enc"))).toBe(true);
  });

  it("encrypted file has 0o600 permissions", async () => {
    await adapter.storeCredentials("alice", "s3cr3t");
    // Windows does not enforce POSIX file modes
    if (process.platform !== "win32") {
      const mode = statSync(join(tmpDir, "credentials.enc")).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("readCredentials round-trips username and password", async () => {
    await adapter.storeCredentials("alice", "s3cr3t");
    const creds = await adapter.readCredentials();
    expect(creds).toEqual({ username: "alice", password: "s3cr3t" });
  });

  it("readCredentials returns null when no file exists", async () => {
    const result = await adapter.readCredentials();
    expect(result).toBeNull();
  });

  it("deleteCredentials removes the file", async () => {
    await adapter.storeCredentials("alice", "s3cr3t");
    await adapter.deleteCredentials();
    expect(existsSync(join(tmpDir, "credentials.enc"))).toBe(false);
  });

  it("deleteCredentials is idempotent when file does not exist", async () => {
    await expect(adapter.deleteCredentials()).resolves.toBeUndefined();
  });

  it("storeCredentials overwrites existing credentials", async () => {
    await adapter.storeCredentials("alice", "pass1");
    await adapter.storeCredentials("bob", "pass2");
    const creds = await adapter.readCredentials();
    expect(creds).toEqual({ username: "bob", password: "pass2" });
  });

  it("file content is not plaintext (password not readable directly)", async () => {
    await adapter.storeCredentials("alice", "s3cr3t");
    const raw = readFileSync(join(tmpDir, "credentials.enc"), "utf8");
    expect(raw).not.toContain("s3cr3t");
    expect(raw).not.toContain("alice");
  });
});

describe("T-6: getMachineId", () => {
  it("returns a non-empty string", async () => {
    const id = await getMachineId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});
