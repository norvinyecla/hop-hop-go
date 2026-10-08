import type { InferUITools, UIDataTypes, UIMessage } from "ai";
import { planTrip } from "./plan-trip";
import { resolveLocation } from "./resolve-location";

export const tools = { resolveLocation, planTrip };

/** A chat message whose tool parts are typed from the tools above. */
export type ChatMessage = UIMessage<unknown, UIDataTypes, InferUITools<typeof tools>>;
