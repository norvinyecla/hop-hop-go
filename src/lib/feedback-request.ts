import { z } from "zod";
import { FEEDBACK_LIMITS, REPLY_RATING_REASONS } from "@/lib/feedback-limits";
import { JsonBodyError, readJson } from "@/lib/read-json";

/** A request /api/feedback refuses. The message is for logs and curious callers; the UI shows its own. */
export class FeedbackRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
    this.name = "FeedbackRequestError";
  }
}

const schema = z
  .object({
    traceId: z.string().regex(/^[0-9a-f]{32}$/),
    token: z.string().max(200),
    /** null clears the rating. */
    rating: z.enum(["up", "down"]).nullable(),
    reason: z.enum(REPLY_RATING_REASONS).optional(),
    comment: z.string().optional(),
    // Reported by the client, so only for slicing the ratings, never trusted.
    hadTrips: z.boolean().optional(),
    finishReason: z.enum(["stop", "length", "content-filter", "tool-calls", "error", "other"]).optional(),
  })
  .refine((body) => body.rating === "down" || (body.reason === undefined && body.comment === undefined), {
    message: "Only a thumbs-down takes a reason or comment",
  });

/** A rating /api/feedback accepted. The whole state of the rating, never a partial update. */
export type FeedbackRequest = z.infer<typeof schema>;

export async function parseFeedbackRequest(
  req: Request,
  limits = FEEDBACK_LIMITS,
): Promise<FeedbackRequest> {
  let body;
  try {
    body = await readJson(req, limits.maxBodyBytes);
  } catch (error) {
    if (!(error instanceof JsonBodyError)) throw error;
    throw new FeedbackRequestError(error.message, error.status);
  }

  const result = schema.safeParse(body);
  if (!result.success) throw new FeedbackRequestError(z.prettifyError(result.error), 400);

  const comment = cleanComment(result.data.comment);
  if (comment && comment.length > limits.maxCommentChars) {
    throw new FeedbackRequestError(`Comments are limited to ${limits.maxCommentChars} characters`, 400);
  }
  return { ...result.data, comment };
}

/** One line of plain text, or undefined when nothing is left. */
function cleanComment(comment: string | undefined): string | undefined {
  const cleaned = comment?.replace(/\p{Cc}+/gu, " ").trim();
  return cleaned || undefined;
}
