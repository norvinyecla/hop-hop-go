/** Why a reply was rated down. Keep in step with the reply_rating_reason score config. */
export const REPLY_RATING_REASONS = ["wrong_place", "bad_route", "wrong_time", "other"] as const;
export type ReplyRatingReason = (typeof REPLY_RATING_REASONS)[number];

/** Limits on what a client may send to /api/feedback. The UI enforces the comment length too. */
export const FEEDBACK_LIMITS = {
  maxBodyBytes: 2_000,
  maxCommentChars: 500,
};
