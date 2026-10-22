import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type ModelMessage } from "ai";
import { after } from "next/server";
import { replyWarning, RESPONSE_LIMITS } from "@/lib/chat-limits";
import { ChatRequestError, parseChatRequest } from "@/lib/chat-request";
import { feedbackConfig } from "@/lib/feedback";
import { signFeedbackToken, verifyFeedbackToken } from "@/lib/feedback-token";
import { instructions } from "@/lib/instructions";
import { getModel } from "@/lib/llm";
import {
  chatRateLimiter,
  clientKey,
  rateLimitHeaders,
  rateLimitMessage,
} from "@/lib/rate-limit";
import { createScores } from "@/lib/scores";
import { buildToolSignalScores, toolCallSignal, type ToolPart } from "@/lib/tool-signals";
import { tools, type ChatMessage } from "@/lib/tools";
import { flushTraces, langfuseConfigured, langfuseEnvironment } from "@/lib/tracing";
import { messageText, turnContext } from "@/lib/turn-context";

// Seconds. Above RESPONSE_LIMITS.maxResponseMs so onAbort and the trace flush in after() still run
// when a reply times out. Must be a literal, so keep it in step with that limit by hand.
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

  const { chatId, messages, previousReply } = chat;
  const feedback = feedbackConfig();
  // The token proves this server sent the previous reply's trace ID, so the link can't point at another chat's trace.
  const previousTraceId =
    feedback && previousReply && verifyFeedbackToken(feedback.key, previousReply.traceId, previousReply.feedbackToken).ok
      ? previousReply.traceId
      : undefined;
  const context = turnContext(messages, previousTraceId);

  // One trace per turn, grouped into a session per conversation. The root observation stays
  // open until the reply has finished streaming, so it can record the reply as the trace output.
  // It's a plain span: the AI SDK's own invoke_agent span under it is the agent. Its metadata
  // carries the reply the user is reacting to, so a correction can be read from this trace alone.
  return startActiveObservation(
    "chat-turn",
    (turn) => {
      turn.update({
        input: lastUserText(messages),
        metadata: { turn: context.turn, previousTurn: context.previousTurn },
      });
      const startedAt = new Date().toISOString();
      // Tool calls from finished steps, scored once the turn ends however it ends.
      const toolParts: ToolPart[] = [];
      let toolSignals: Promise<void> | undefined;
      let ended = false;
      const end = (
        output: unknown,
        {
          metadata,
          level,
          statusMessage,
          aborted = false,
        }: { metadata?: Record<string, unknown>; level?: "WARNING" | "ERROR"; statusMessage?: string; aborted?: boolean } = {},
      ) => {
        if (ended) return;
        ended = true;
        turn.update({ output, metadata, level, statusMessage });
        turn.end();
        if (!langfuseConfigured()) return;
        // A tool stopped by the client leaves an error that isn't the tool's fault.
        const parts = aborted ? toolParts.filter((part) => part.type !== "tool-error") : toolParts;
        const scores = buildToolSignalScores(parts.map(toolCallSignal), {
          traceId: turn.traceId,
          timestamp: startedAt,
          environment: langfuseEnvironment(),
        });
        toolSignals = createScores(scores).catch((error: unknown) => console.error("Couldn't save tool signals:", error));
      };

      // Runs once the response has finished streaming, or failed.
      after(() => Promise.all([flushTraces(), toolSignals]));

      try {
        return propagateAttributes({ traceName: "chat-turn", sessionId: chatId, tags: context.tags }, () => {
          const result = streamText({
            model: getModel(),
            instructions: instructions(),
            messages,
            tools,
            stopWhen: isStepCount(RESPONSE_LIMITS.maxSteps),
            maxOutputTokens: RESPONSE_LIMITS.maxOutputTokens,
            // Stops the model and any running tools when the client disconnects.
            abortSignal: req.signal,
            timeout: { totalMs: RESPONSE_LIMITS.maxResponseMs },
            telemetry: { functionId: "chat-turn" },
            onStepEnd: ({ content }) => {
              for (const part of content) {
                if (part.type === "tool-result" || part.type === "tool-error") toolParts.push(part);
              }
            },
            onEnd: ({ text, finishReason, steps }) => {
              const warning = replyWarning(finishReason, steps.length);
              end(text, {
                metadata: { finishReason, steps: steps.length },
                ...(warning && { level: "WARNING", statusMessage: warning }),
              });
            },
            // The AI SDK's spans don't record a failed model call, so this is the only place the error shows up.
            onError: ({ error }) => end(undefined, { level: "ERROR", statusMessage: String(error) }),
            onAbort: () =>
              end(undefined, { level: "WARNING", statusMessage: "Stopped before the reply finished.", aborted: true }),
          });

          return createUIMessageStreamResponse({
            stream: toUIMessageStream<typeof tools, ChatMessage>({
              stream: result.stream,
              messageMetadata: ({ part }) => {
                // Sent before any output, so stopped and failed replies can be rated too.
                if (part.type === "start" && feedback) {
                  return { traceId: turn.traceId, feedbackToken: signFeedbackToken(feedback.key, turn.traceId) };
                }
                // The last finish part carries the final step's reason, so the UI can say when a reply hit the cap.
                if (part.type === "finish") return { finishReason: part.finishReason };
              },
            }),
            headers,
          });
        });
      } catch (error) {
        // Thrown before streaming started, e.g. a missing LLM_API_KEY. The stream callbacks never run.
        end(undefined, { level: "ERROR", statusMessage: String(error) });
        throw error;
      }
    },
    { endOnExit: false },
  );
}

/** The user's latest message, as the trace input, rather than the whole history. */
function lastUserText(messages: ModelMessage[]): string | undefined {
  const last = messages.at(-1);
  return last?.role === "user" ? messageText(last) : undefined;
}
