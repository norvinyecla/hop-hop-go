import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { instructions } from "@/lib/instructions";
import { getModel } from "@/lib/llm";
import {
  chatRateLimiter,
  clientKey,
  rateLimitHeaders,
  rateLimitMessage,
} from "@/lib/rate-limit";
import { tools } from "@/lib/tools";

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

  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: getModel(),
    instructions: instructions(),
    // Pass tools so planTrip's toModelOutput also applies to results from earlier turns.
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    stopWhen: isStepCount(5),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
    headers,
  });
}
