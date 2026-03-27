// REQ-AUTH-002, REQ-SEC-001, REQ-SEC-004
import keytar from "keytar";
import { platform } from "node:os";

const SERVICE = "moodle-scraper";

export class PlatformNotSupportedError extends Error {
  constructor(plat: string) {
    super(`This tool requires macOS Keychain. Current platform: ${plat}.`);
    this.name = "PlatformNotSupportedError";
  }
}

export interface Credentials {
  username: string;
  password: string;
}

export class KeychainAdapter {
  private readonly platform: string;
  private storedUsername: string | null = null;

  constructor(opts?: { platform?: string }) {
    this.platform = opts?.platform ?? platform();
  }

  private assertMacOS(): void {
    if (this.platform !== "darwin") {
      throw new PlatformNotSupportedError(this.platform);
    }
  }

  private async assertedOp<T>(fn: () => Promise<T>): Promise<T> {
    this.assertMacOS();
    return fn();
  }

  async storeCredentials(username: string, password: string): Promise<void> {
    return this.assertedOp(async () => {
      try {
        await keytar.setPassword(SERVICE, username, password);
        this.storedUsername = username;
      } catch (err) {
        throw new Error(
          `Error: could not save credentials to Keychain — ${(err as Error).message}.`
        );
      }
    });
  }

  async readCredentials(): Promise<Credentials | null> {
    return this.assertedOp(async () => {
      try {
        // If we have a username in memory, do a direct lookup
        if (this.storedUsername) {
          const password = await keytar.getPassword(SERVICE, this.storedUsername);
          if (password === null) return null;
          return { username: this.storedUsername, password };
        }
        // Otherwise discover stored accounts for this service
        const found = await keytar.findCredentials(SERVICE);
        if (found.length === 0) return null;
        const { account, password } = found[0]!;
        this.storedUsername = account;
        return { username: account, password };
      } catch (err) {
        throw new Error(
          `Error: could not read credentials from Keychain — ${(err as Error).message}.`
        );
      }
    });
  }

  async deleteCredentials(): Promise<void> {
    return this.assertedOp(async () => {
      if (this.storedUsername) {
        await keytar.deletePassword(SERVICE, this.storedUsername);
        this.storedUsername = null;
      }
    });
  }

  setStoredUsername(username: string): void {
    this.storedUsername = username;
  }
}
