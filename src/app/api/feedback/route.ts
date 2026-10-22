import { applyScoreChanges, buildScoreChanges, feedbackConfig } from "@/lib/feedback";
import { FeedbackRequestError, parseFeedbackRequest } from "@/lib/feedback-request";
import { verifyFeedbackToken } from "@/lib/feedback-token";
import {
  clientKey,
  feedbackRateLimiter,
  rateLimitHeaders,
  rateLimitMessage,
} from "@/lib/rate-limit";

/** Records a thumbs up or down on a reply as reply_rating (and reply_rating_reason) scores on its trace. */
export async function POST(req: Request) {
  // Check before reading the body so blocked requests cost nothing.
  const rateLimit = await feedbackRateLimiter.limit(clientKey(req));
  const headers = rateLimitHeaders(rateLimit);
  const text = (body: string, status: number) =>
    new Response(body, { status, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });

  if (!rateLimit.success) return text(rateLimitMessage(Number(headers["Retry-After"]), "rating replies"), 429);

  const config = feedbackConfig();
  if (!config) return text("Feedback isn't available.", 503);

  let feedback;
  try {
    feedback = await parseFeedbackRequest(req);
  } catch (error) {
    if (!(error instanceof FeedbackRequestError)) throw error;
    return text(error.message, error.status);
  }

  // The token proves this server sent the trace ID, so callers can only rate their own replies.
  const token = verifyFeedbackToken(config.key, feedback.traceId, feedback.token);
  if (!token.ok) {
    return token.reason === "expired" ? text("This reply can no longer be rated.", 410) : text("Invalid token.", 403);
  }

  try {
    await applyScoreChanges(buildScoreChanges(feedback, token.issuedAt, config));
  } catch (error) {
    console.error("Couldn't save reply rating:", error);
    return text("Couldn't save the rating.", 502);
  }
  return new Response(null, { status: 204, headers });
}
