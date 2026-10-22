import { describe, expect, it } from "vitest";
import { buildToolSignalScores, toolCallSignal, type ToolCallSignal, type ToolPart } from "./tool-signals";
import { DATE_RANGE_ERROR, SERVICE_ALERTS_UNAVAILABLE } from "./tools/get-service-alerts";
import { PAST_TIME_ERROR, PLAN_TRIP_UNAVAILABLE } from "./tools/plan-trip";
import { RESOLVE_LOCATION_UNAVAILABLE } from "./tools/resolve-location";

const traceId = "0123456789abcdef0123456789abcdef";
const options = { traceId, timestamp: "2026-10-22T03:04:05.000Z", environment: "test" };
const shared = { traceId, timestamp: "2026-10-22T03:04:05.000Z", environment: "test" };

const journey = {
  departs: "08:10",
  arrives: "08:40",
  durationMin: 30,
  changes: 0,
  legs: [{ mode: "train", from: "Central", to: "Parramatta", departs: "08:10", arrives: "08:40", durationMin: 30, path: [] }],
};

const planTrip = (id: string, output: Record<string, unknown>) =>
  ({
    type: "tool-result",
    toolCallId: id,
    toolName: "planTrip",
    input: { originId: "1", destinationId: "2", preference: "balanced" },
    output: { journeys: [], ...output },
  }) as ToolPart;

const resolveLocation = (id: string, query: string, output: Record<string, unknown> = {}) =>
  ({
    type: "tool-result",
    toolCallId: id,
    toolName: "resolveLocation",
    input: { query },
    output: { query, candidates: [{ id: "200060", name: "Central Station", type: "stop", isBest: true }], ...output },
  }) as ToolPart;

const getServiceAlerts = (id: string, output: Record<string, unknown> = {}) =>
  ({
    type: "tool-result",
    toolCallId: id,
    toolName: "getServiceAlerts",
    input: { lines: [] },
    output: { total: 0, alerts: [], ...output },
  }) as ToolPart;

const signals = (...parts: ToolPart[]): ToolCallSignal[] => parts.map(toolCallSignal);

describe("toolCallSignal", () => {
  it("tells outages from bad input and empty results", () => {
    expect(
      signals(
        planTrip("a", { journeys: [journey] }),
        planTrip("b", { error: PLAN_TRIP_UNAVAILABLE }),
        planTrip("c", { error: PAST_TIME_ERROR }),
        planTrip("d", { avoid: ["bus"], message: "No journey avoiding buses was found between these locations." }),
        resolveLocation("e", "Central"),
        resolveLocation("f", "Xyzzyville", { candidates: [] }),
        resolveLocation("g", "Central", { candidates: [], error: RESOLVE_LOCATION_UNAVAILABLE }),
        getServiceAlerts("h"),
        getServiceAlerts("i", { error: DATE_RANGE_ERROR }),
        getServiceAlerts("j", { error: SERVICE_ALERTS_UNAVAILABLE }),
      ).map(({ toolCallId, outcome }) => [toolCallId, outcome]),
    ).toEqual([
      ["a", "ok"],
      ["b", "unavailable"],
      ["c", "bad_input"],
      ["d", "no_journeys"],
      ["e", "ok"],
      ["f", "no_location_match"],
      ["g", "unavailable"],
      ["h", "ok"],
      ["i", "bad_input"],
      ["j", "unavailable"],
    ]);
  });

  it("treats a call that ended as a tool error as an exception", () => {
    const part = { type: "tool-error", toolCallId: "a", toolName: "planTrip", input: {}, error: new Error("Invalid input") };
    expect(toolCallSignal(part as ToolPart)).toEqual({ toolCallId: "a", toolName: "planTrip", outcome: "exception" });
  });

  it("keeps planTrip's avoid and resolveLocation's query", () => {
    expect(signals(planTrip("a", { avoid: ["bus"] }), resolveLocation("b", "Manly Wharf"))).toEqual([
      { toolCallId: "a", toolName: "planTrip", outcome: "no_journeys", avoid: ["bus"] },
      { toolCallId: "b", toolName: "resolveLocation", outcome: "ok", query: "Manly Wharf" },
    ]);
  });
});

describe("buildToolSignalScores", () => {
  it("sends nothing for a turn without tools", () => {
    expect(buildToolSignalScores([], options)).toEqual([]);
  });

  it("records a clean turn as false for each signal that could have happened", () => {
    expect(buildToolSignalScores(signals(resolveLocation("a", "Central"), planTrip("b", { journeys: [journey] })), options)).toEqual([
      { ...shared, id: `tool_error-${traceId}`, name: "tool_error", value: 0, dataType: "BOOLEAN" },
      { ...shared, id: `no_journeys_returned-${traceId}`, name: "no_journeys_returned", value: 0, dataType: "BOOLEAN" },
      { ...shared, id: `no_location_match-${traceId}`, name: "no_location_match", value: 0, dataType: "BOOLEAN" },
    ]);
  });

  it("records an outage with its reason, and leaves out signals the failed call couldn't show", () => {
    expect(buildToolSignalScores(signals(planTrip("a", { error: PLAN_TRIP_UNAVAILABLE })), options)).toEqual([
      {
        ...shared,
        id: `tool_error-${traceId}`,
        name: "tool_error",
        value: 1,
        dataType: "BOOLEAN",
        comment: "planTrip: unavailable",
        metadata: { recovered: false, calls: [{ toolCallId: "a", tool: "planTrip", reason: "unavailable", recovered: false }] },
      },
      { ...shared, id: `tool_error_reason-${traceId}`, name: "tool_error_reason", value: "unavailable", dataType: "CATEGORICAL" },
    ]);
  });

  it("keeps the worst reason when several calls failed", () => {
    const scores = buildToolSignalScores(
      signals(planTrip("a", { error: PAST_TIME_ERROR }), getServiceAlerts("b", { error: SERVICE_ALERTS_UNAVAILABLE })),
      options,
    );
    expect(scores.find((score) => score.name === "tool_error")?.comment).toBe("planTrip: bad_input; getServiceAlerts: unavailable");
    expect(scores.find((score) => score.name === "tool_error_reason")?.value).toBe("unavailable");
  });

  it("marks a failure recovered when a later call of the same tool worked", () => {
    const [toolError] = buildToolSignalScores(
      signals(planTrip("a", { error: PAST_TIME_ERROR }), planTrip("b", { journeys: [journey] })),
      options,
    );
    expect(toolError).toMatchObject({
      value: 1,
      metadata: { recovered: true, calls: [{ toolCallId: "a", recovered: true }] },
    });
  });

  it("doesn't count a later call of another tool as recovery", () => {
    const [toolError] = buildToolSignalScores(
      signals(planTrip("a", { error: PLAN_TRIP_UNAVAILABLE }), resolveLocation("b", "Central")),
      options,
    );
    expect(toolError.metadata).toMatchObject({ recovered: false });
  });

  it("records no journeys with the modes avoided", () => {
    const scores = buildToolSignalScores(
      signals(planTrip("a", { avoid: ["bus", "light rail"] }), planTrip("b", { journeys: [journey] })),
      options,
    );
    expect(scores.map((score) => [score.name, score.value])).toEqual([
      ["tool_error", 0],
      ["no_journeys_returned", 1],
    ]);
    expect(scores[1]).toMatchObject({
      comment: "Avoiding bus, light rail",
      metadata: { avoid: true, recovered: true, calls: [{ toolCallId: "a", avoid: ["bus", "light rail"], recovered: true }] },
    });
  });

  it("records no location match with the query", () => {
    const scores = buildToolSignalScores(signals(resolveLocation("a", "Xyzzyville", { candidates: [] })), options);
    expect(scores.map((score) => [score.name, score.value])).toEqual([
      ["tool_error", 0],
      ["no_location_match", 1],
    ]);
    expect(scores[1]).toMatchObject({
      comment: '"Xyzzyville"',
      metadata: { recovered: false, calls: [{ toolCallId: "a", query: "Xyzzyville", recovered: false }] },
    });
  });

  it("counts an exception as a tool error", () => {
    const part = { type: "tool-error", toolCallId: "a", toolName: "planTrip", input: {}, error: new Error("boom") } as ToolPart;
    expect(buildToolSignalScores(signals(part), options).map((score) => [score.name, score.value])).toEqual([
      ["tool_error", 1],
      ["tool_error_reason", "exception"],
    ]);
  });
});
