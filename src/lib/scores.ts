import { LangfuseClient } from "@langfuse/client";

export type CreateScore = Parameters<LangfuseClient["api"]["scores"]["create"]>[0][number];

/** One score of each name per trace, so sending it again replaces the score instead of adding one. */
export const scoreId = (name: string, traceId: string) => `${name}-${traceId}`;

let client: LangfuseClient | undefined;

/** Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL. */
export function langfuse(): LangfuseClient {
  return (client ??= new LangfuseClient());
}

/**
 * Sends scores with the REST API directly rather than the batching score queue, so there's
 * nothing left to flush when the response ends. Throws if Langfuse rejects any of them.
 */
export async function createScores(scores: CreateScore[]): Promise<void> {
  if (scores.length === 0) return;
  const result = await langfuse().api.scores.create(scores);
  // 202 is { message: "Accepted" }; 207 lists the scores that were rejected, e.g. by a score config.
  if ("rejected" in result && result.rejected > 0) {
    throw new Error(`Langfuse rejected ${result.rejected} score(s): ${JSON.stringify(result.errors)}`);
  }
}
