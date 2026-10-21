import { describe, expect, it } from "vitest";
import { buildScoreChanges, feedbackConfig, type FeedbackConfig } from "./feedback";

const traceId = "0123456789abcdef0123456789abcdef";
const issuedAt = Date.UTC(2026, 9, 21, 3, 4, 5);
const config: FeedbackConfig = {
  key: Buffer.from("key"),
  ratingConfigId: "cfg-rating",
  reasonConfigId: "cfg-reason",
  environment: "test",
};

const shared = { traceId, timestamp: "2026-10-21T03:04:05.000Z", environment: "test" };

describe("buildScoreChanges", () => {
  it("records a thumbs up and clears any earlier reason", () => {
    expect(buildScoreChanges({ traceId, token: "t", rating: "up", hadTrips: true, finishReason: "stop" }, issuedAt, config)).toEqual({
      create: [
        {
          ...shared,
          id: `reply_rating-${traceId}`,
          name: "reply_rating",
          value: 1,
          dataType: "BOOLEAN",
          configId: "cfg-rating",
          comment: undefined,
          metadata: { hadTrips: true, finishReason: "stop" },
        },
      ],
      delete: [`reply_rating_reason-${traceId}`],
    });
  });

  it("records a thumbs down with its comment and reason", () => {
    const changes = buildScoreChanges(
      { traceId, token: "t", rating: "down", reason: "wrong_place", comment: "Wrong Central" },
      issuedAt,
      config,
    );
    expect(changes.delete).toEqual([]);
    expect(changes.create).toEqual([
      expect.objectContaining({ id: `reply_rating-${traceId}`, value: 0, dataType: "BOOLEAN", comment: "Wrong Central" }),
      {
        ...shared,
        id: `reply_rating_reason-${traceId}`,
        name: "reply_rating_reason",
        value: "wrong_place",
        dataType: "CATEGORICAL",
        configId: "cfg-reason",
      },
    ]);
  });

  it("keeps the same score IDs and timestamp across re-ratings, so they update in place", () => {
    const up = buildScoreChanges({ traceId, token: "t", rating: "up" }, issuedAt, config).create[0];
    const down = buildScoreChanges({ traceId, token: "t", rating: "down" }, issuedAt, config).create[0];
    expect([down.id, down.name, down.timestamp]).toEqual([up.id, up.name, up.timestamp]);
  });

  it("deletes both scores when the rating is cleared", () => {
    expect(buildScoreChanges({ traceId, token: "t", rating: null }, issuedAt, config)).toEqual({
      create: [],
      delete: [`reply_rating-${traceId}`, `reply_rating_reason-${traceId}`],
    });
  });
});

describe("feedbackConfig", () => {
  const env = {
    LANGFUSE_PUBLIC_KEY: "pk",
    LANGFUSE_SECRET_KEY: "sk",
    LANGFUSE_REPLY_RATING_CONFIG_ID: "a",
    LANGFUSE_REPLY_RATING_REASON_CONFIG_ID: "b",
    NODE_ENV: "production",
  };

  it("needs the Langfuse keys and both config IDs", () => {
    expect(feedbackConfig(env)).toMatchObject({ ratingConfigId: "a", reasonConfigId: "b", environment: "production" });
    expect(feedbackConfig({ ...env, LANGFUSE_SECRET_KEY: "" })).toBeUndefined();
    expect(feedbackConfig({ ...env, LANGFUSE_REPLY_RATING_REASON_CONFIG_ID: undefined })).toBeUndefined();
  });

  it("uses LANGFUSE_TRACING_ENVIRONMENT, like the traces", () => {
    expect(feedbackConfig({ ...env, LANGFUSE_TRACING_ENVIRONMENT: "staging" })?.environment).toBe("staging");
  });
});
