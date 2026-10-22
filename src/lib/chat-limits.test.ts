import { describe, expect, it } from "vitest";
import { replyWarning, RESPONSE_LIMITS } from "./chat-limits";

describe("replyWarning", () => {
  it("flags a reply that hit the output token cap", () => {
    expect(replyWarning("length", 2)).toBe("Hit the output token cap.");
  });

  it("flags a reply the step limit stopped mid tool call", () => {
    expect(replyWarning("tool-calls", RESPONSE_LIMITS.maxSteps)).toBe("Hit the step limit.");
  });

  it("doesn't flag tool calls that ended before the step limit", () => {
    expect(replyWarning("tool-calls", RESPONSE_LIMITS.maxSteps - 1)).toBeUndefined();
  });

  it("doesn't flag a reply that finished normally, even on the last step", () => {
    expect(replyWarning("stop", RESPONSE_LIMITS.maxSteps)).toBeUndefined();
  });
});
