import type { FinishReason, InferUITools, UIDataTypes, UIMessage } from "ai";
import { getServiceAlerts } from "./get-service-alerts";
import { planTrip } from "./plan-trip";
import { resolveLocation } from "./resolve-location";

export const tools = { resolveLocation, planTrip, getServiceAlerts };

/**
 * Set by /api/chat: traceId and feedbackToken when a reply starts (only when feedback is set up),
 * finishReason when it ends. /api/chat never reads what clients send back; /api/feedback
 * checks the token before trusting the trace ID.
 */
export type ChatMetadata = { traceId?: string; feedbackToken?: string; finishReason?: FinishReason };

/** A chat message whose tool parts are typed from the tools above. */
export type ChatMessage = UIMessage<ChatMetadata, UIDataTypes, InferUITools<typeof tools>>;
