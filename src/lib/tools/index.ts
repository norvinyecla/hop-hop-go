import type { FinishReason, InferUITools, Tool, UIDataTypes, UIMessage } from "ai";
import { classifyToolOutput, markToolObservation } from "@/lib/tool-signals";
import { getServiceAlerts } from "./get-service-alerts";
import { planTrip } from "./plan-trip";
import { resolveLocation } from "./resolve-location";

export const tools = {
  resolveLocation: withObservationLevel("resolveLocation", resolveLocation),
  planTrip: withObservationLevel("planTrip", planTrip),
  getServiceAlerts: withObservationLevel("getServiceAlerts", getServiceAlerts),
};

/** Marks the tool's observation in the trace when its result says it failed or found nothing. */
function withObservationLevel<T extends Tool>(toolName: "resolveLocation" | "planTrip" | "getServiceAlerts", tool: T): T {
  const { execute } = tool;
  if (!execute) return tool;
  return {
    ...tool,
    execute: async (...args: Parameters<typeof execute>) => {
      const output = await execute(...args);
      markToolObservation(toolName, classifyToolOutput({ toolName, output } as Parameters<typeof classifyToolOutput>[0]));
      return output;
    },
  };
}

/**
 * Set by /api/chat: traceId and feedbackToken when a reply starts (only when feedback is set up),
 * finishReason when it ends. /api/chat never reads what clients send back; /api/feedback
 * checks the token before trusting the trace ID.
 */
export type ChatMetadata = { traceId?: string; feedbackToken?: string; finishReason?: FinishReason };

/** A chat message whose tool parts are typed from the tools above. */
export type ChatMessage = UIMessage<ChatMetadata, UIDataTypes, InferUITools<typeof tools>>;
