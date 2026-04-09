// REQ-ERR-012
import type { StateManager } from "../sync/state.js";
import { cleanPartialFiles } from "../fs/output.js";

export interface ShutdownHandlers {
  cleanup(): Promise<void>;
  /** Deregister the SIGINT/SIGTERM handlers (called at end of scrape to avoid leaking listeners). */
  unregister(): void;
}

export function registerShutdownHandlers(opts: {
  stateManager: StateManager;
  outputDir: string;
  /** Called to get the current partial state for saving on interrupt. */
  getPartialState?: () => { courses: Record<string, unknown>; generatedFiles?: string[] } | null;
}): ShutdownHandlers {
  const { stateManager, outputDir, getPartialState } = opts;

  const cleanup = async () => {
    // Save whatever state has accumulated so far (avoids re-downloading everything)
    const partialState = getPartialState?.();
    if (partialState) {
      try { await stateManager.save(partialState as Parameters<StateManager["save"]>[0]); } catch { /* best-effort */ }
    }
    await cleanPartialFiles(outputDir);
    process.stdout.write("\nInterrupted. Progress saved.\n");
  };

  const sigintHandler = () => { cleanup().then(() => process.exit(130)); };
  const sigtermHandler = () => { cleanup().then(() => process.exit(143)); };

  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);

  const unregister = () => {
    process.off("SIGINT", sigintHandler);
    process.off("SIGTERM", sigtermHandler);
  };

  return { cleanup, unregister };
}
