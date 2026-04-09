// Tests for process/shutdown.ts — SIGINT/SIGTERM handler registration

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("registerShutdownHandlers", () => {
  let onSpy: ReturnType<typeof vi.spyOn>;
  let offSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    onSpy = vi.spyOn(process, "on").mockImplementation(() => process);
    offSpy = vi.spyOn(process, "off").mockImplementation(() => process);
  });

  afterEach(() => {
    onSpy.mockRestore();
    offSpy.mockRestore();
  });

  it("registers SIGINT and SIGTERM handlers", async () => {
    const { registerShutdownHandlers } = await import("../../src/process/shutdown.js");
    const mockSave = vi.fn().mockResolvedValue(undefined);
    const mockLoad = vi.fn().mockResolvedValue(null);
    const sm = { load: mockLoad, save: mockSave, statePath: "/tmp/.state.json" } as never;

    registerShutdownHandlers({ stateManager: sm, outputDir: "/tmp/out" });

    const sigintCalls = onSpy.mock.calls.filter(([ev]) => ev === "SIGINT");
    const sigtermCalls = onSpy.mock.calls.filter(([ev]) => ev === "SIGTERM");
    expect(sigintCalls.length).toBe(1);
    expect(sigtermCalls.length).toBe(1);
  });

  it("unregister removes the handlers", async () => {
    const { registerShutdownHandlers } = await import("../../src/process/shutdown.js");
    const mockSave = vi.fn().mockResolvedValue(undefined);
    const sm = { load: vi.fn(), save: mockSave, statePath: "/tmp/.state.json" } as never;

    const { unregister } = registerShutdownHandlers({ stateManager: sm, outputDir: "/tmp/out" });
    unregister();

    const offCalls = offSpy.mock.calls;
    expect(offCalls.some(([ev]) => ev === "SIGINT")).toBe(true);
    expect(offCalls.some(([ev]) => ev === "SIGTERM")).toBe(true);
  });

  it("cleanup calls getPartialState and saves it", async () => {
    const { registerShutdownHandlers } = await import("../../src/process/shutdown.js");
    const mockSave = vi.fn().mockResolvedValue(undefined);
    const sm = { load: vi.fn(), save: mockSave, statePath: "/tmp/.state.json" } as never;
    const partialState = { courses: { "1": { name: "Test" } }, generatedFiles: ["/tmp/out/README.md"] };

    const { cleanup, unregister } = registerShutdownHandlers({
      stateManager: sm,
      outputDir: "/tmp/nonexistent-dir-for-test",
      getPartialState: () => partialState,
    });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await cleanup();
    stdoutSpy.mockRestore();
    unregister();

    expect(mockSave).toHaveBeenCalledWith(partialState);
  });

  it("cleanup works without getPartialState (no state saved)", async () => {
    const { registerShutdownHandlers } = await import("../../src/process/shutdown.js");
    const mockSave = vi.fn().mockResolvedValue(undefined);
    const sm = { load: vi.fn(), save: mockSave, statePath: "/tmp/.state.json" } as never;

    const { cleanup, unregister } = registerShutdownHandlers({
      stateManager: sm,
      outputDir: "/tmp/nonexistent-dir-for-test",
    });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await cleanup();
    stdoutSpy.mockRestore();
    unregister();

    expect(mockSave).not.toHaveBeenCalled();
  });
});
