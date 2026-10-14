import { describe, expect, it } from "vitest";
import { RESPONSE_LIMITS } from "@/lib/chat-limits";
import { maxDuration } from "./route";

describe("chat route config", () => {
  it("gives the platform timeout room beyond the response limit", () => {
    expect(maxDuration * 1000).toBeGreaterThan(RESPONSE_LIMITS.maxResponseMs);
  });
});
