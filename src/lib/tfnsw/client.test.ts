import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tfnswGet } from "./client";

describe("tfnswGet", () => {
  let fetchSignal: AbortSignal | undefined;

  beforeEach(() => {
    vi.stubEnv("TFNSW_API_KEY", "test");
    // Never answers, so only an abort ends the request.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        fetchSignal = init.signal ?? undefined;
        return new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchSignal = undefined;
  });

  it("stops the request when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const request = tfnswGet("trip", {}, controller.signal);
    controller.abort();

    await expect(request).rejects.toThrow();
    expect(fetchSignal?.aborted).toBe(true);
  });

  it.each([
    ["without a caller's signal", undefined],
    ["with a caller's signal", new AbortController().signal],
  ])("still times out after 8 seconds %s", async (_, signal) => {
    // AbortSignal.timeout runs on Node's own timers, which fake timers don't control.
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const request = tfnswGet("trip", {}, signal);
    expect(timeoutSpy).toHaveBeenCalledWith(8000);
    expect(fetchSignal?.aborted).toBe(false);

    timeout.abort();

    await expect(request).rejects.toThrow();
    expect(fetchSignal?.aborted).toBe(true);
  });
});
