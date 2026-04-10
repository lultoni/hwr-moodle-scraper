// REQ-AUTH-002, REQ-SEC-001, REQ-SEC-004
import { platform } from "node:os";

const SERVICE = "moodle-scraper";

// Lazy-loaded keytar module (optional dependency — may not be installed on non-macOS)
type KeytarModule = typeof import("keytar");
let _keytar: KeytarModule | undefined;

async function getKeytar(): Promise<KeytarModule> {
  if (_keytar) return _keytar;
  try {
    _keytar = (await import("keytar")).default as unknown as KeytarModule;
    return _keytar;
  } catch {
    throw new Error(
      "keytar is not available. Install it with: npm install keytar"
    );
  }
}

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
        await (await getKeytar()).setPassword(SERVICE, username, password);
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
        const kt = await getKeytar();
        // If we have a username in memory, do a direct lookup
        if (this.storedUsername) {
          const password = await kt.getPassword(SERVICE, this.storedUsername);
          if (password === null) return null;
          return { username: this.storedUsername, password };
        }
        // Otherwise discover stored accounts for this service
        const found = await kt.findCredentials(SERVICE);
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
        await (await getKeytar()).deletePassword(SERVICE, this.storedUsername);
        this.storedUsername = null;
      }
    });
  }

  setStoredUsername(username: string): void {
    this.storedUsername = username;
  }
}

/**
 * Attempt to create a KeychainAdapter. Returns null on non-macOS platforms,
 * allowing callers to degrade gracefully to prompt-every-time mode.
 */
export function tryCreateKeychain(): KeychainAdapter | null {
  if (platform() !== "darwin") return null;
  return new KeychainAdapter();
}
