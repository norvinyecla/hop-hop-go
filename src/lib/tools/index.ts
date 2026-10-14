import type { FinishReason, InferUITools, UIDataTypes, UIMessage } from "ai";
import { getServiceAlerts } from "./get-service-alerts";
import { planTrip } from "./plan-trip";
import { resolveLocation } from "./resolve-location";

export const tools = { resolveLocation, planTrip, getServiceAlerts };

/** Set by /api/chat when a reply ends. For display only: clients send it back, so the server never reads it. */
export type ChatMetadata = { finishReason?: FinishReason };

/** A chat message whose tool parts are typed from the tools above. */
export type ChatMessage = UIMessage<ChatMetadata, UIDataTypes, InferUITools<typeof tools>>;
