import { describe, expect, it } from "vitest";
import { FEEDBACK_LIMITS } from "./feedback-limits";
import { FeedbackRequestError, parseFeedbackRequest } from "./feedback-request";

const traceId = "0123456789abcdef0123456789abcdef";

function post(body: unknown): Request {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function rejection(body: unknown): Promise<FeedbackRequestError> {
  const error = await parseFeedbackRequest(post(body)).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FeedbackRequestError);
  return error as FeedbackRequestError;
}

describe("parseFeedbackRequest", () => {
  it("accepts a thumbs up, a thumbs down with a reason and comment, and a clear", async () => {
    expect(await parseFeedbackRequest(post({ traceId, token: "t", rating: "up", hadTrips: true }))).toEqual({
      traceId,
      token: "t",
      rating: "up",
      hadTrips: true,
    });
    expect(
      await parseFeedbackRequest(
        post({ traceId, token: "t", rating: "down", reason: "bad_route", comment: "Too many changes", finishReason: "stop" }),
      ),
    ).toMatchObject({ rating: "down", reason: "bad_route", comment: "Too many changes", finishReason: "stop" });
    expect(await parseFeedbackRequest(post({ traceId, token: "t", rating: null }))).toMatchObject({ rating: null });
  });

  it("drops fields it doesn't know", async () => {
    const feedback = await parseFeedbackRequest(post({ traceId, token: "t", rating: "up", name: "other_score", value: 5 }));
    expect(feedback).not.toHaveProperty("name");
    expect(feedback).not.toHaveProperty("value");
  });

  it("trims the comment, flattens control characters and drops it when blank", async () => {
    expect(
      await parseFeedbackRequest(post({ traceId, token: "t", rating: "down", comment: "  wrong\n\tstop  " })),
    ).toMatchObject({ comment: "wrong stop" });
    const blank = await parseFeedbackRequest(post({ traceId, token: "t", rating: "down", comment: "   " }));
    expect(blank.comment).toBeUndefined();
  });

  it("rejects a reason or comment without a thumbs-down", async () => {
    expect((await rejection({ traceId, token: "t", rating: "up", reason: "other" })).status).toBe(400);
    expect((await rejection({ traceId, token: "t", rating: null, comment: "hi" })).status).toBe(400);
  });

  it("rejects bad trace IDs, ratings and reasons", async () => {
    expect((await rejection({ traceId: "not-a-trace", token: "t", rating: "up" })).status).toBe(400);
    expect((await rejection({ traceId: traceId.toUpperCase(), token: "t", rating: "up" })).status).toBe(400);
    expect((await rejection({ traceId, token: "t", rating: 1 })).status).toBe(400);
    expect((await rejection({ traceId, token: "t", rating: "down", reason: "too_slow" })).status).toBe(400);
    expect((await rejection({ traceId, rating: "up" })).status).toBe(400);
  });

  it("rejects long comments, oversized bodies and invalid JSON", async () => {
    const long = "x".repeat(FEEDBACK_LIMITS.maxCommentChars + 1);
    expect((await rejection({ traceId, token: "t", rating: "down", comment: long })).status).toBe(400);
    expect((await rejection({ traceId, token: "t".repeat(FEEDBACK_LIMITS.maxBodyBytes), rating: "up" })).status).toBe(413);
    expect((await rejection("{")).status).toBe(400);
  });
});
