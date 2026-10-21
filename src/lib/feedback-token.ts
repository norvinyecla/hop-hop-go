import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a reply can be rated. Messages aren't kept across reloads, so this is generous. */
export const FEEDBACK_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The key that signs feedback tokens, derived from the Langfuse secret key so there's nothing
 * else to configure. Rotating that key only invalidates tokens for replies still on screen.
 */
export function feedbackKey(langfuseSecretKey: string): Buffer {
  return createHmac("sha256", langfuseSecretKey).update("hop-hop-go/reply-feedback/v1").digest();
}

/**
 * A token that lets the client rate one trace. /api/chat sends it with the reply, so
 * /api/feedback only scores traces this server created. issuedAt doubles as the score
 * timestamp, which must stay the same for re-ratings to update the score.
 */
export function signFeedbackToken(key: Buffer, traceId: string, issuedAt = Date.now()): string {
  return `v1.${issuedAt}.${sign(key, traceId, issuedAt)}`;
}

export type FeedbackTokenCheck = { ok: true; issuedAt: number } | { ok: false; reason: "invalid" | "expired" };

export function verifyFeedbackToken(
  key: Buffer,
  traceId: string,
  token: string,
  now = Date.now(),
): FeedbackTokenCheck {
  const [version, issued, signature, ...rest] = token.split(".");
  if (version !== "v1" || !issued || !signature || rest.length > 0 || !/^\d{1,15}$/.test(issued)) {
    return { ok: false, reason: "invalid" };
  }
  const issuedAt = Number(issued);
  const expected = Buffer.from(sign(key, traceId, issuedAt));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "invalid" };
  }
  if (now - issuedAt > FEEDBACK_TOKEN_TTL_MS) return { ok: false, reason: "expired" };
  return { ok: true, issuedAt };
}

function sign(key: Buffer, traceId: string, issuedAt: number): string {
  return createHmac("sha256", key).update(`${traceId}.${issuedAt}`).digest("base64url");
}
