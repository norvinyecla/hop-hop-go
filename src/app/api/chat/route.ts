import { createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream } from "ai";
import { RESPONSE_LIMITS } from "@/lib/chat-limits";
import { ChatRequestError, parseChatRequest } from "@/lib/chat-request";
import { instructions } from "@/lib/instructions";
import { getModel } from "@/lib/llm";
import {
  chatRateLimiter,
  clientKey,
  rateLimitHeaders,
  rateLimitMessage,
} from "@/lib/rate-limit";
import { tools, type ChatMessage } from "@/lib/tools";

// Platform timeout in seconds. Next reads it at build time, so it must be a literal. Keep it
// above RESPONSE_LIMITS.maxResponseMs so the SDK's timeout ends the stream before the platform kills it.
export const maxDuration = 90;

export async function POST(req: Request) {
  // Check before reading the body so blocked requests cost nothing.
  const rateLimit = await chatRateLimiter.limit(clientKey(req));
  const headers = rateLimitHeaders(rateLimit);
  if (!rateLimit.success) {
    return new Response(rateLimitMessage(Number(headers["Retry-After"])), {
      status: 429,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let messages;
  try {
    messages = await parseChatRequest(req);
  } catch (error) {
    if (!(error instanceof ChatRequestError)) throw error;
    return new Response(error.message, {
      status: error.status,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const result = streamText({
    model: getModel(),
    instructions: instructions(),
    messages,
    tools,
    stopWhen: isStepCount(5),
    maxOutputTokens: RESPONSE_LIMITS.maxOutputTokens,
    // Stops the model and any running tools when the client disconnects.
    abortSignal: req.signal,
    timeout: { totalMs: RESPONSE_LIMITS.maxResponseMs },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof tools, ChatMessage>({
      stream: result.stream,
      // The last finish part carries the final step's reason, so the UI can say when a reply hit the cap.
      messageMetadata: ({ part }) => (part.type === "finish" ? { finishReason: part.finishReason } : undefined),
    }),
    headers,
  });
}
