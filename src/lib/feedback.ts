import type { FeedbackRequest } from "@/lib/feedback-request";
import { feedbackKey } from "@/lib/feedback-token";
import { createScores, langfuse, scoreId, type CreateScore } from "@/lib/scores";
import { langfuseConfigured, langfuseEnvironment } from "@/lib/tracing";

export const REPLY_RATING = "reply_rating";
export const REPLY_RATING_REASON = "reply_rating_reason";

export type FeedbackConfig = {
  /** Signs and checks feedback tokens. */
  key: Buffer;
  /** Langfuse score configs, created with scripts/create-score-configs.mjs. */
  ratingConfigId: string;
  reasonConfigId: string;
  environment?: string;
};

/**
 * Feedback needs Langfuse tracing plus both score configs. Without them, /api/chat sends no
 * trace ID, so the UI shows no rating controls, and /api/feedback refuses requests.
 */
export function feedbackConfig(env: Record<string, string | undefined> = process.env): FeedbackConfig | undefined {
  const ratingConfigId = env.LANGFUSE_REPLY_RATING_CONFIG_ID;
  const reasonConfigId = env.LANGFUSE_REPLY_RATING_REASON_CONFIG_ID;
  if (!langfuseConfigured(env) || !ratingConfigId || !reasonConfigId) return undefined;
  return {
    key: feedbackKey(env.LANGFUSE_SECRET_KEY!),
    ratingConfigId,
    reasonConfigId,
    environment: langfuseEnvironment(env),
  };
}

export type ScoreChanges = { create: CreateScore[]; delete: string[] };

/**
 * The scores that make Langfuse match the user's current rating. Every score is sent whole:
 * Langfuse replaces a score only when its id, name and timestamp's date all match, and
 * partial updates are deprecated.
 */
export function buildScoreChanges(feedback: FeedbackRequest, issuedAt: number, config: FeedbackConfig): ScoreChanges {
  const { traceId, rating, reason, comment, hadTrips, finishReason } = feedback;
  const ratingId = scoreId(REPLY_RATING, traceId);
  const reasonId = scoreId(REPLY_RATING_REASON, traceId);
  if (rating === null) return { create: [], delete: [ratingId, reasonId] };

  const shared = {
    traceId,
    timestamp: new Date(issuedAt).toISOString(),
    environment: config.environment,
  };
  const create: CreateScore[] = [
    {
      ...shared,
      id: ratingId,
      name: REPLY_RATING,
      value: rating === "up" ? 1 : 0,
      dataType: "BOOLEAN",
      configId: config.ratingConfigId,
      comment,
      metadata: { hadTrips, finishReason },
    },
  ];
  if (reason) {
    create.push({
      ...shared,
      id: reasonId,
      name: REPLY_RATING_REASON,
      value: reason,
      dataType: "CATEGORICAL",
      configId: config.reasonConfigId,
    });
  }
  return { create, delete: reason ? [] : [reasonId] };
}

/**
 * Sends the changes and waits for Langfuse to accept them, so a failure reaches the client
 * and a later clear can't overtake an earlier rating. Uses the REST API directly rather than
 * the batching score queue, so there's nothing left to flush when the response ends.
 */
export async function applyScoreChanges(changes: ScoreChanges): Promise<void> {
  await Promise.all([
    createScores(changes.create),
    ...changes.delete.map((id) =>
      langfuse().api.scores.delete(id).catch((error: unknown) => {
        // Nothing to clear, e.g. no reason was picked.
        if ((error as { statusCode?: number }).statusCode !== 404) throw error;
      }),
    ),
  ]);
}
