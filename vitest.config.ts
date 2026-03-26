import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Tests must be deterministic — no real timers in unit tests
    fakeTimers: {
      // opt-in per test via vi.useFakeTimers()
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
    // Resolve src/ as if it were the root so tests import from "src/…"
    alias: {
      "#src/": new URL("./src/", import.meta.url).pathname,
    },
  },
});
