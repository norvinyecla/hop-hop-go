/** Limits on what a client may send to /api/chat. The client trims to these too. */
export const CHAT_LIMITS = {
  /** Raw request body. Map paths in planTrip results make up most of it. */
  maxBodyBytes: 1_000_000,
  /** Messages in the history, counting user and assistant messages. */
  maxMessages: 30,
  /** Characters of text in one user message. */
  maxUserTextChars: 2_000,
  /** Characters of the history as the model sees it, which leaves out map paths. */
  maxModelChars: 200_000,
};

/**
 * The most recent messages that fit within maxMessages, starting at a user message so a
 * reply is never cut off from its question.
 */
export function recentMessages<M extends { role: string }>(
  messages: M[],
  max = CHAT_LIMITS.maxMessages,
): M[] {
  if (messages.length <= max) return messages;
  const recent = messages.slice(-max);
  const start = recent.findIndex((m) => m.role === "user");
  return start === -1 ? recent.slice(-1) : recent.slice(start);
}
