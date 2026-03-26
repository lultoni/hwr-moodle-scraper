// REQ-ERR-012
import type { StateManager } from "../sync/state.js";
import { cleanPartialFiles } from "../fs/output.js";

export interface ShutdownHandlers {
  cleanup(): Promise<void>;
}

export function registerShutdownHandlers(opts: {
  stateManager: StateManager;
  outputDir: string;
}): ShutdownHandlers {
  const { stateManager, outputDir } = opts;

  const cleanup = async () => {
    await cleanPartialFiles(outputDir);
    process.stdout.write("Interrupted. Progress saved.\n");
  };

  process.on("SIGINT", () => { cleanup().then(() => process.exit(0)); });
  process.on("SIGTERM", () => { cleanup().then(() => process.exit(0)); });

  return { cleanup };
}
