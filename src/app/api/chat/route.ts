import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type ModelMessage } from "ai";
import { after } from "next/server";
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
import { flushTraces } from "@/lib/tracing";

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

  let chat;
  try {
    chat = await parseChatRequest(req);
  } catch (error) {
    if (!(error instanceof ChatRequestError)) throw error;
    return new Response(error.message, {
      status: error.status,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const { chatId, messages } = chat;

  // One trace per turn, grouped into a session per conversation. The root observation stays
  // open until the reply has finished streaming, so it can record the reply as the trace output.
  // It's a plain span: the AI SDK's own invoke_agent span under it is the agent.
  return startActiveObservation(
    "chat-turn",
    (turn) => {
      turn.update({ input: lastUserText(messages) });
      let ended = false;
      const end = (output: unknown, metadata?: Record<string, unknown>, level?: "WARNING" | "ERROR") => {
        if (ended) return;
        ended = true;
        turn.update({ output, metadata, level });
        turn.end();
      };

      return propagateAttributes({ traceName: "chat-turn", sessionId: chatId }, () => {
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
          telemetry: { functionId: "chat-turn" },
          onEnd: ({ text, finishReason, steps }) =>
            end(text, { finishReason, steps: steps.length }, finishReason === "length" ? "WARNING" : undefined),
          onError: ({ error }) => end(String(error), undefined, "ERROR"),
          onAbort: () => end("Stopped before the reply finished.", undefined, "WARNING"),
        });

        // Runs once the response has finished streaming.
        after(flushTraces);

        return createUIMessageStreamResponse({
          stream: toUIMessageStream<typeof tools, ChatMessage>({
            stream: result.stream,
            // The last finish part carries the final step's reason, so the UI can say when a reply hit the cap.
            messageMetadata: ({ part }) => (part.type === "finish" ? { finishReason: part.finishReason } : undefined),
          }),
          headers,
        });
      });
    },
    { endOnExit: false },
  );
}

/** The user's latest message, as the trace input, rather than the whole history. */
function lastUserText(messages: ModelMessage[]): string | undefined {
  const last = messages.at(-1);
  if (last?.role !== "user") return undefined;
  if (typeof last.content === "string") return last.content;
  return last.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}
