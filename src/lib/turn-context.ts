import type { InferToolInput, InferToolOutput, ModelMessage } from "ai";
import type { getServiceAlerts } from "@/lib/tools/get-service-alerts";
import type { planTrip } from "@/lib/tools/plan-trip";
import type { resolveLocation } from "@/lib/tools/resolve-location";

/** Earlier user messages kept in a trace, so a constraint given a few turns back is still visible. */
const MAX_EARLIER_USER_MESSAGES = 10;
const MAX_CANDIDATES = 3;
const MAX_ALERTS = 5;

type ToolSummary =
  | {
      tool: "planTrip";
      from: string;
      to: string;
      when?: { type: "depart" | "arrive"; date: string; time: string };
      avoid?: string[];
      preference?: string;
      journeys: { departs: string; arrives: string; day?: string; changes: number; legs: string[] }[];
      message?: string;
      error?: string;
    }
  | { tool: "resolveLocation"; query: string; candidates: string[]; error?: string }
  | {
      tool: "getServiceAlerts";
      lines: string[];
      fromDate?: string;
      toDate?: string;
      total: number;
      alerts: string[];
      error?: string;
    }
  | { tool: string; error: string };

/** The turn the user's latest message replies to, as recorded on the trace. */
export type PreviousTurn = {
  /** The previous turn's trace, when the client proved this server sent it. */
  traceId?: string;
  userMessage: string;
  reply: string;
  /** What the reply's tools were asked and found, without map paths. */
  tools: ToolSummary[];
  /** The user's messages before userMessage, oldest first. */
  earlierUserMessages: string[];
};

export type TurnContext = {
  /** 1 for the first user message in the conversation. */
  turn: number;
  previousTurn?: PreviousTurn;
  /** "followup" when there is a previous reply, and "prev-tool:<name>" for each tool it used. */
  tags: string[];
};

/**
 * What a turn's trace needs to show the reply the user is reacting to, so a correction like
 * "I said arrive by 9" can be read without opening the previous trace. The history was checked
 * against the tool schemas in parseChatRequest, so tool inputs and outputs have their types.
 */
export function turnContext(messages: ModelMessage[], previousTraceId?: string): TurnContext {
  const userIndexes = messages.flatMap((message, i) => (message.role === "user" ? [i] : []));
  const turn = userIndexes.length;
  if (turn < 2) return { turn, tags: [] };

  const start = userIndexes.at(-2)!;
  const replyMessages = messages.slice(start + 1, userIndexes.at(-1));
  const names = locationNames(messages);

  const replyText: string[] = [];
  const calls: { id: string; name: string; input: unknown }[] = [];
  const results = new Map<string, { value?: unknown; error?: string }>();
  for (const message of replyMessages) {
    if (message.role === "assistant") {
      if (typeof message.content === "string") {
        replyText.push(message.content);
        continue;
      }
      for (const part of message.content) {
        if (part.type === "text") replyText.push(part.text);
        if (part.type === "tool-call") calls.push({ id: part.toolCallId, name: part.toolName, input: part.input });
      }
    } else if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type !== "tool-result") continue;
        const { output } = part;
        if (output.type === "json") results.set(part.toolCallId, { value: output.value });
        else if (output.type === "error-text") results.set(part.toolCallId, { error: output.value });
        else if (output.type === "error-json") results.set(part.toolCallId, { error: JSON.stringify(output.value) });
      }
    }
  }

  const tools = calls.flatMap((call) => {
    const result = results.get(call.id);
    if (!result) return [];
    if (result.value === undefined) return [{ tool: call.name, error: result.error ?? "No result." }];
    return [summarize(call.name, call.input, result.value, names)];
  });
  const reply = replyText.join("\n").trim();

  const previousTurn: PreviousTurn = {
    ...(previousTraceId && { traceId: previousTraceId }),
    userMessage: messageText(messages[start]),
    reply,
    tools,
    earlierUserMessages: userIndexes.slice(0, -2).slice(-MAX_EARLIER_USER_MESSAGES).map((i) => messageText(messages[i])),
  };
  // A reply that failed before saying or doing anything leaves nothing to react to.
  const tags = reply || tools.length > 0 ? ["followup", ...new Set(calls.map((call) => `prev-tool:${call.name}`))] : [];
  return { turn, previousTurn, tags };
}

/** The text of a message, ignoring anything that isn't text. */
export function messageText(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function summarize(tool: string, input: unknown, value: unknown, names: Map<string, string>): ToolSummary {
  switch (tool) {
    case "planTrip": {
      const { originId, destinationId, preference } = input as InferToolInput<typeof planTrip>;
      const { when, avoid, journeys, message, error } = value as InferToolOutput<typeof planTrip>;
      return {
        tool,
        from: names.get(originId) ?? originId,
        to: names.get(destinationId) ?? destinationId,
        when,
        avoid,
        preference,
        journeys: journeys.map(({ departs, arrives, day, changes, legs }) => ({
          departs,
          arrives,
          day,
          changes,
          legs: legs.map((leg) => `${leg.mode}${leg.line ? ` ${leg.line}` : ""}: ${leg.from} → ${leg.to}`),
        })),
        message,
        error,
      };
    }
    case "resolveLocation": {
      const { query, candidates, error } = value as InferToolOutput<typeof resolveLocation>;
      return { tool, query, candidates: candidates.slice(0, MAX_CANDIDATES).map((c) => c.name), error };
    }
    case "getServiceAlerts": {
      const { lines = [], fromDate, toDate } = input as InferToolInput<typeof getServiceAlerts>;
      const { total, alerts, error } = value as InferToolOutput<typeof getServiceAlerts>;
      return { tool, lines, fromDate, toDate, total, alerts: alerts.slice(0, MAX_ALERTS).map((a) => a.title), error };
    }
    default:
      return { tool, error: "Unknown tool." };
  }
}

/** Location names by ID, from every resolveLocation result in the history, since planTrip only gets IDs. */
function locationNames(messages: ModelMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result" || part.toolName !== "resolveLocation" || part.output.type !== "json") continue;
      const { candidates } = part.output.value as InferToolOutput<typeof resolveLocation>;
      for (const { id, name } of candidates) names.set(id, name);
    }
  }
  return names;
}
