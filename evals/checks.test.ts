import { describe, expect, it } from "vitest";
import { resolveDay, runChecks, type CaseOutput } from "./checks";

// Thursday 22 October 2026, 08:00 in Sydney.
const NOW = "2026-10-21T21:00:00.000Z";

function output(overrides: Partial<CaseOutput> = {}): CaseOutput {
  return { now: NOW, reply: "Take the T4.", finishReason: "stop", steps: 3, calls: [], fixtureMisses: [], ...overrides };
}

const resolve = (query: string, ids: string[]) => ({
  tool: "resolveLocation",
  input: { query },
  output: { query, candidates: ids.map((id) => ({ id })) },
});
const plan = (input: Record<string, unknown>) => ({
  tool: "planTrip",
  input: { originId: "a", destinationId: "b", ...input },
  output: { journeys: [] },
});

const failed = (results: { name: string; passed: boolean }[]) => results.filter((r) => !r.passed).map((r) => r.name);

describe("resolveDay", () => {
  it.each([
    ["today", "2026-10-22"],
    ["tomorrow", "2026-10-23"],
    ["thursday", "2026-10-22"],
    ["saturday", "2026-10-24"],
    ["wednesday", "2026-10-28"],
  ] as const)("%s is %s", (day, date) => {
    expect(resolveDay(day, new Date(NOW))).toBe(date);
  });
});

describe("runChecks", () => {
  it("passes a trip that matches", () => {
    const results = runChecks(
      { resolves: ["central", "bondi junction"], planTrip: { avoid: ["bus"], preference: "balanced", when: null } },
      output({ calls: [resolve("Central Station", ["a"]), resolve("Bondi Junction", ["b"]), plan({ avoid: ["bus"] })] }),
    );
    expect(failed(results)).toEqual([]);
  });

  it("checks the last planTrip call", () => {
    const results = runChecks(
      { planTrip: { avoid: null } },
      output({ calls: [resolve("x", ["a", "b"]), plan({ avoid: ["bus"] }), plan({})] }),
    );
    expect(failed(results)).toEqual([]);
  });

  it("fails when avoid, preference or when differ", () => {
    const results = runChecks(
      {
        planTrip: {
          avoid: ["metro"],
          preference: "fastest",
          when: { type: "arrive", day: "tomorrow", time: "09:00" },
        },
      },
      output({
        calls: [resolve("x", ["a", "b"]), plan({ avoid: ["train"], when: { type: "arrive", date: "2026-10-22", time: "09:00" } })],
      }),
    );
    expect(failed(results)).toEqual(["plan_avoid", "plan_preference", "plan_when"]);
  });

  it("fails ids that didn't come from resolveLocation", () => {
    const results = runChecks({}, output({ calls: [resolve("x", ["a"]), plan({})] }));
    expect(failed(results)).toEqual(["ids_from_resolve"]);
  });

  it("fails places that weren't looked up", () => {
    const results = runChecks({ resolves: ["central", "wynyard"] }, output({ calls: [resolve("Central", ["a"])] }));
    expect(failed(results)).toEqual(["resolves_places"]);
  });

  it("fails Markdown, unfinished replies and fixture misses", () => {
    const results = runChecks(
      {},
      output({ reply: "**Take the T4**", finishReason: "tool-calls", fixtureMisses: ["trip?x=1"] }),
    );
    expect(failed(results)).toEqual(["finished", "plain_text", "fixtures_complete"]);
  });

  it("fills in the alert dates the tool defaults to", () => {
    const call = { tool: "getServiceAlerts", input: { lines: ["t1"], fromDate: "2026-10-24" }, output: {} };
    expect(failed(runChecks({ alerts: { lines: ["T1"], from: "saturday", to: "sunday" } }, output({ calls: [call] })))).toEqual([
      "alerts_dates",
    ]);
    expect(failed(runChecks({ alerts: { from: "saturday" } }, output({ calls: [call] })))).toEqual([]);
  });

  it("fails a route when there shouldn't be one", () => {
    const withJourney = { ...plan({}), output: { journeys: [{}] } };
    expect(failed(runChecks({ noRoute: true }, output({ calls: [resolve("x", ["a", "b"]), plan({})] })))).toEqual([]);
    expect(failed(runChecks({ noRoute: true }, output({ calls: [resolve("x", ["a", "b"]), withJourney] })))).toEqual([
      "no_route",
    ]);
  });

  it.each([
    ["Take the T4 to Bondi Junction.", false],
    ["Catch the 333 bus.", false],
    ["Bus 440 leaves soon.", false],
    ["It leaves at 5:07.", false],
    ["You'd arrive around 9am.", false],
    ["Trip planning is unavailable right now. Try again in a few minutes.", true],
    ["Central to Randwick is about 4 km.", true],
  ])("no_route_details on %j passes: %s", (reply, passes) => {
    expect(failed(runChecks({ noRouteDetails: true }, output({ reply })))).toEqual(passes ? [] : ["no_route_details"]);
  });

  it("checks follow-ups and calls that shouldn't happen", () => {
    const results = runChecks(
      { planTrip: false, alerts: false, asksFollowUp: true, noTools: true },
      output({ calls: [resolve("x", ["a", "b"]), plan({})] }),
    );
    expect(failed(results)).toEqual(["no_plan_trip", "asks_follow_up", "no_tools"]);
  });
});
