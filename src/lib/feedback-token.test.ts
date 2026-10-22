import { describe, expect, it } from "vitest";
import { FEEDBACK_TOKEN_TTL_MS, feedbackKey, signFeedbackToken, verifyFeedbackToken } from "./feedback-token";

const key = feedbackKey("sk-lf-test");
const traceId = "0123456789abcdef0123456789abcdef";
const issuedAt = 1_760_000_000_000;

describe("feedback tokens", () => {
  it("verifies a token for the trace it was signed for", () => {
    const token = signFeedbackToken(key, traceId, issuedAt);
    expect(verifyFeedbackToken(key, traceId, token, issuedAt + 1000)).toEqual({ ok: true, issuedAt });
  });

  it("rejects a token for another trace", () => {
    const token = signFeedbackToken(key, traceId, issuedAt);
    expect(verifyFeedbackToken(key, "f".repeat(32), token, issuedAt)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a changed issue time or signature", () => {
    const [, , signature] = signFeedbackToken(key, traceId, issuedAt).split(".");
    expect(verifyFeedbackToken(key, traceId, `v1.${issuedAt + 1}.${signature}`, issuedAt)).toMatchObject({ ok: false });
    expect(verifyFeedbackToken(key, traceId, `v1.${issuedAt}.${signature.slice(1)}x`, issuedAt)).toMatchObject({ ok: false });
  });

  it("rejects a token signed with another key", () => {
    const token = signFeedbackToken(feedbackKey("sk-lf-other"), traceId, issuedAt);
    expect(verifyFeedbackToken(key, traceId, token, issuedAt)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects malformed tokens", () => {
    for (const token of ["", "v1", "v2.1.abc", "v1.abc.def", "v1.1.abc.extra", `v1.${"9".repeat(16)}.abc`]) {
      expect(verifyFeedbackToken(key, traceId, token, issuedAt)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("expires after a day", () => {
    const token = signFeedbackToken(key, traceId, issuedAt);
    expect(verifyFeedbackToken(key, traceId, token, issuedAt + FEEDBACK_TOKEN_TTL_MS).ok).toBe(true);
    expect(verifyFeedbackToken(key, traceId, token, issuedAt + FEEDBACK_TOKEN_TTL_MS + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
