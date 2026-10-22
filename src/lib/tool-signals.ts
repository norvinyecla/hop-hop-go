import { LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { trace } from "@opentelemetry/api";
import type { InferToolOutput, TypedToolError, TypedToolResult } from "ai";
import { scoreId, type CreateScore } from "@/lib/scores";
import type { tools } from "@/lib/tools";
import { SERVICE_ALERTS_UNAVAILABLE } from "@/lib/tools/get-service-alerts";
import { PLAN_TRIP_UNAVAILABLE } from "@/lib/tools/plan-trip";
import { RESOLVE_LOCATION_UNAVAILABLE } from "@/lib/tools/resolve-location";

type Tools = typeof tools;

export const TOOL_ERROR = "tool_error";
export const TOOL_ERROR_REASON = "tool_error_reason";
export const NO_JOURNEYS_RETURNED = "no_journeys_returned";
export const NO_LOCATION_MATCH = "no_location_match";

/**
 * Why a tool couldn't do its job, worst first. unavailable: a TfNSW request failed.
 * exception: the input failed the schema or the tool threw. bad_input: the tool turned down
 * what the model asked for, e.g. a time that has passed.
 */
export const TOOL_ERROR_REASONS = ["unavailable", "exception", "bad_input"] as const;
export type ToolErrorReason = (typeof TOOL_ERROR_REASONS)[number];

/** Empty results aren't errors: the tool worked, but found nothing. */
export type ToolOutcome = "ok" | ToolErrorReason | "no_journeys" | "no_location_match";

const UNAVAILABLE = new Set([PLAN_TRIP_UNAVAILABLE, RESOLVE_LOCATION_UNAVAILABLE, SERVICE_ALERTS_UNAVAILABLE]);

type ToolOutput = { [Name in keyof Tools]: { toolName: Name; output: InferToolOutput<Tools[Name]> } }[keyof Tools];

/** What a tool's result says about the call. Tools report failures in their output rather than throwing. */
export function classifyToolOutput({ toolName, output }: ToolOutput): Exclude<ToolOutcome, "exception"> {
  if (output.error) return UNAVAILABLE.has(output.error) ? "unavailable" : "bad_input";
  if (toolName === "planTrip" && output.journeys.length === 0) return "no_journeys";
  if (toolName === "resolveLocation" && output.candidates.length === 0) return "no_location_match";
  return "ok";
}

export type ToolCallSignal = {
  toolCallId: string;
  toolName: string;
  outcome: ToolOutcome;
  /** planTrip's modes left out. */
  avoid?: string[];
  /** resolveLocation's query. */
  query?: string;
};

/** A finished tool call from a step's content. */
export type ToolPart = TypedToolResult<Tools> | TypedToolError<Tools>;

export function toolCallSignal(part: ToolPart): ToolCallSignal {
  const { toolCallId, toolName } = part;
  if (part.type === "tool-error") return { toolCallId, toolName, outcome: "exception" };
  // Every tool here is static, but the union also allows dynamic ones.
  if (part.dynamic) return { toolCallId, toolName, outcome: "ok" };
  const outcome = classifyToolOutput(part);
  if (part.toolName === "planTrip") return { toolCallId, toolName, outcome, avoid: part.output.avoid };
  if (part.toolName === "resolveLocation") return { toolCallId, toolName, outcome, query: part.output.query };
  return { toolCallId, toolName, outcome };
}

/**
 * Marks the running tool's observation, so failures stand out in the trace. Call from inside
 * execute, where the AI SDK makes the tool's span active. Does nothing when tracing is off.
 */
export function markToolObservation(toolName: string, outcome: ToolOutcome) {
  if (outcome === "ok") return;
  const span = trace.getActiveSpan();
  // Without the AI SDK telemetry the active span would be the turn's, which this mustn't mark.
  if (!span || (span as { name?: string }).name !== `execute_tool ${toolName}`) return;
  span.setAttributes({
    [LangfuseOtelSpanAttributes.OBSERVATION_LEVEL]: outcome === "unavailable" ? "ERROR" : "WARNING",
    [LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE]: outcome,
  });
}

const FAILED = new Set<ToolOutcome>(TOOL_ERROR_REASONS);

/**
 * Scores for a turn's tool calls, in the order they ran. Each score is only sent on turns
 * where it could have happened, so its average is a rate: tool_error on turns that called a
 * tool, no_journeys_returned on turns where planTrip ran without an error, and so on. A
 * failure counts even when a later call of the same tool in the turn worked; metadata says so.
 */
export function buildToolSignalScores(
  calls: ToolCallSignal[],
  { traceId, timestamp, environment }: { traceId: string; timestamp: string; environment?: string },
): CreateScore[] {
  const shared = { traceId, timestamp, environment };
  const recovered = (call: ToolCallSignal) =>
    calls.slice(calls.indexOf(call) + 1).some((later) => later.toolName === call.toolName && later.outcome === "ok");
  const scores: CreateScore[] = [];

  if (calls.length > 0) {
    const failed = calls.filter((call) => FAILED.has(call.outcome));
    scores.push({
      ...shared,
      id: scoreId(TOOL_ERROR, traceId),
      name: TOOL_ERROR,
      value: failed.length > 0 ? 1 : 0,
      dataType: "BOOLEAN",
      ...(failed.length > 0 && {
        comment: failed.map((call) => `${call.toolName}: ${call.outcome}`).join("; "),
        metadata: {
          recovered: failed.every(recovered),
          calls: failed.map((call) => ({
            toolCallId: call.toolCallId,
            tool: call.toolName,
            reason: call.outcome,
            recovered: recovered(call),
          })),
        },
      }),
    });
    const worst = TOOL_ERROR_REASONS.find((reason) => failed.some((call) => call.outcome === reason));
    if (worst) {
      scores.push({ ...shared, id: scoreId(TOOL_ERROR_REASON, traceId), name: TOOL_ERROR_REASON, value: worst, dataType: "CATEGORICAL" });
    }
  }

  const trips = calls.filter((call) => call.toolName === "planTrip" && !FAILED.has(call.outcome));
  if (trips.length > 0) {
    const empty = trips.filter((call) => call.outcome === "no_journeys");
    scores.push({
      ...shared,
      id: scoreId(NO_JOURNEYS_RETURNED, traceId),
      name: NO_JOURNEYS_RETURNED,
      value: empty.length > 0 ? 1 : 0,
      dataType: "BOOLEAN",
      ...(empty.length > 0 && {
        comment: empty.map((call) => (call.avoid ? `Avoiding ${call.avoid.join(", ")}` : "No modes avoided")).join("; "),
        metadata: {
          avoid: empty.some((call) => call.avoid !== undefined),
          recovered: empty.every(recovered),
          calls: empty.map((call) => ({ toolCallId: call.toolCallId, avoid: call.avoid, recovered: recovered(call) })),
        },
      }),
    });
  }

  const lookups = calls.filter((call) => call.toolName === "resolveLocation" && !FAILED.has(call.outcome));
  if (lookups.length > 0) {
    const empty = lookups.filter((call) => call.outcome === "no_location_match");
    scores.push({
      ...shared,
      id: scoreId(NO_LOCATION_MATCH, traceId),
      name: NO_LOCATION_MATCH,
      value: empty.length > 0 ? 1 : 0,
      dataType: "BOOLEAN",
      ...(empty.length > 0 && {
        comment: empty.map((call) => `"${call.query}"`).join("; "),
        metadata: {
          recovered: empty.every(recovered),
          calls: empty.map((call) => ({ toolCallId: call.toolCallId, query: call.query, recovered: recovered(call) })),
        },
      }),
    });
  }

  return scores;
}
