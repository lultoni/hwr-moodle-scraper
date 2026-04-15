// Encrypted file credential store for non-macOS platforms (Linux, WSL, Windows).
//
// Uses AES-256-GCM with PBKDF2 key derivation from a machine-specific ID.
// File format: JSON { iv: hex, salt: hex, ct: hex } with 0o600 permissions.
// This provides meaningful protection against casual inspection while being
// portable without external dependencies.

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { hostname, userInfo } from "node:os";

const CRED_FILE = "credentials.enc";
const ALGORITHM = "aes-256-gcm";
const PBKDF2_ITERATIONS = 100_000;
const KEY_LEN = 32;
const SALT_LEN = 32;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

let _cachedMachineId: string | undefined;

/** Derive the machine-specific key material (non-secret — used as PBKDF2 input). Cached after first call. */
export async function getMachineId(): Promise<string> {
  if (_cachedMachineId) return _cachedMachineId;
  // Linux: /etc/machine-id or /var/lib/dbus/machine-id
  for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const id = readFileSync(path, "utf8").trim();
      if (id) { _cachedMachineId = id; return id; }
    } catch { /* not found on this platform, try next */ }
  }
  // Fallback: deterministic hash of hostname + username
  const fallback = `${hostname()}:${userInfo().username}`;
  _cachedMachineId = createHash("sha256").update(fallback).digest("hex");
  return _cachedMachineId;
}

interface EncFile {
  iv: string;
  salt: string;
  ct: string;
}

export class EncryptedFileAdapter {
  private readonly credPath: string;

  constructor(configDir: string) {
    this.credPath = join(configDir, CRED_FILE);
  }

  async storeCredentials(username: string, password: string): Promise<void> {
    const machineId = await getMachineId();
    const salt = randomBytes(SALT_LEN);
    const iv = randomBytes(IV_LEN);
    const key = pbkdf2Sync(machineId, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const plaintext = JSON.stringify({ username, password });
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);

    const data: EncFile = {
      iv: iv.toString("hex"),
      salt: salt.toString("hex"),
      ct: ct.toString("hex"),
    };
    writeFileSync(this.credPath, JSON.stringify(data), { mode: 0o600 });
  }

  async readCredentials(): Promise<{ username: string; password: string } | null> {
    try {
      const raw = readFileSync(this.credPath, "utf8");
      const data = JSON.parse(raw) as EncFile;
      const machineId = await getMachineId();
      const salt = Buffer.from(data.salt, "hex");
      const iv = Buffer.from(data.iv, "hex");
      const ctBuf = Buffer.from(data.ct, "hex");

      const key = pbkdf2Sync(machineId, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");

      // Split ciphertext from auth tag (last 16 bytes)
      const authTag = ctBuf.slice(ctBuf.length - AUTH_TAG_LEN);
      const ct = ctBuf.slice(0, ctBuf.length - AUTH_TAG_LEN);

      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      return JSON.parse(plaintext) as { username: string; password: string };
    } catch {
      return null;
    }
  }

  async deleteCredentials(): Promise<void> {
    try {
      unlinkSync(this.credPath);
    } catch { /* file does not exist — nothing to do */ }
  }
}
