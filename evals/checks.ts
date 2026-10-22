import { normalizeAvoid, type AvoidableMode } from "@/lib/avoid";
import { plainText } from "@/lib/plain-text";
import { addDays, sydneyDate } from "@/lib/sydney-time";
import type { Expectations, RelativeDay } from "./cases";

/** One tool call from the reply, with its result or error. */
export type ToolCallRecord = { tool: string; input: unknown; output?: unknown; error?: string };

/** What running a case produced. It's the trace output in Langfuse, so keep it plain JSON. */
export type CaseOutput = {
  /** The time the case ran as, from its fixtures. */
  now: string;
  reply: string;
  finishReason: string;
  steps: number;
  calls: ToolCallRecord[];
  /** TfNSW requests with no recording. Not set when recording. */
  fixtureMisses?: string[];
};

export type CheckResult = { name: string; passed: boolean; detail?: string };

type PlanTripInput = {
  originId: string;
  destinationId: string;
  preference?: string;
  when?: { type: string; date: string; time: string };
  avoid?: AvoidableMode[];
};
type AlertsInput = { lines?: string[]; fromDate?: string; toDate?: string };
type ResolveOutput = { candidates?: { id: string }[] };

/** Things only a planned journey could tell it: line codes like T4 or L2, bus routes and clock times. */
const ROUTE_DETAIL = /\b[TML]\d\b|\b(?:bus|route)\s+\d{2,3}[A-Z]?\b|\b\d{2,3}[A-Z]?\s+bus\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*[ap]\.?m\b/gi;

const WEEKDAYS =["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The Sydney date (YYYY-MM-DD) a relative day means at `now`. */
export function resolveDay(day: RelativeDay, now: Date): string {
  const today = sydneyDate(now);
  if (day === "today") return today;
  if (day === "tomorrow") return addDays(today, 1);
  const todayIndex = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, (WEEKDAYS.indexOf(day) - todayIndex + 7) % 7);
}

function check(name: string, passed: boolean, detail?: string): CheckResult {
  return passed ? { name, passed } : { name, passed, detail };
}

const show = (value: unknown) => JSON.stringify(value ?? null);

/** Runs every check that applies to the case. Checks only look at tool calls and the reply text. */
export function runChecks(expect: Expectations, output: CaseOutput): CheckResult[] {
  const now = new Date(output.now);
  const callsTo = (tool: string) => output.calls.filter((call) => call.tool === tool);
  const plans = callsTo("planTrip");
  const resolves = callsTo("resolveLocation");
  const alerts = callsTo("getServiceAlerts");
  const results: CheckResult[] = [
    check("finished", output.finishReason === "stop" && output.reply.trim() !== "", `finishReason ${output.finishReason}`),
    check("plain_text", plainText(output.reply) === output.reply, "reply contains Markdown"),
  ];

  if (output.fixtureMisses) {
    results.push(
      check("fixtures_complete", output.fixtureMisses.length === 0, `not recorded: ${output.fixtureMisses.join(", ")}`),
    );
  }

  if (plans.length > 0) {
    // Ids must come from resolveLocation results, never from the model's memory.
    const known = new Set(
      resolves.flatMap((call) => (call.output as ResolveOutput | undefined)?.candidates?.map((c) => c.id) ?? []),
    );
    const unknown = plans
      .flatMap((call) => [(call.input as PlanTripInput).originId, (call.input as PlanTripInput).destinationId])
      .filter((id) => !known.has(id));
    results.push(check("ids_from_resolve", unknown.length === 0, `ids not from resolveLocation: ${unknown.join(", ")}`));
  }

  if (expect.resolves) {
    const queries = resolves.map((call) => String((call.input as { query?: string }).query ?? "").toLowerCase());
    const missing = expect.resolves.filter((place) => !queries.some((query) => query.includes(place.toLowerCase())));
    results.push(check("resolves_places", missing.length === 0, `not looked up: ${missing.join(", ")}; queries: ${show(queries)}`));
  }

  if (expect.planTrip === false) {
    results.push(check("no_plan_trip", plans.length === 0, `planTrip called ${plans.length} time(s)`));
  } else if (expect.planTrip) {
    const last = plans.at(-1)?.input as PlanTripInput | undefined;
    results.push(check("plan_trip_called", last !== undefined, "planTrip not called"));
    if (last) {
      const want = expect.planTrip;
      if (want.avoid !== undefined) {
        const expected = normalizeAvoid(want.avoid ?? undefined);
        const actual = normalizeAvoid(last.avoid);
        results.push(check("plan_avoid", show(expected) === show(actual), `avoid ${show(actual)}, expected ${show(expected)}`));
      }
      if (want.preference !== undefined) {
        const actual = last.preference ?? "balanced";
        results.push(check("plan_preference", actual === want.preference, `preference ${actual}, expected ${want.preference}`));
      }
      if (want.when !== undefined) {
        const expected = want.when && { type: want.when.type, date: resolveDay(want.when.day, now), time: want.when.time };
        const actual = last.when && { type: last.when.type, date: last.when.date, time: last.when.time };
        results.push(check("plan_when", show(expected) === show(actual), `when ${show(actual)}, expected ${show(expected)}`));
      }
    }
  }

  if (expect.alerts === false) {
    results.push(check("no_alerts", alerts.length === 0, `getServiceAlerts called ${alerts.length} time(s)`));
  } else if (expect.alerts) {
    const last = alerts.at(-1)?.input as AlertsInput | undefined;
    results.push(check("alerts_called", last !== undefined, "getServiceAlerts not called"));
    if (last) {
      const want = expect.alerts;
      if (want.lines) {
        const actual = (last.lines ?? []).map((line) => line.toUpperCase()).sort();
        const expected = want.lines.map((line) => line.toUpperCase()).sort();
        results.push(check("alerts_lines", show(actual) === show(expected), `lines ${show(actual)}, expected ${show(expected)}`));
      }
      if (want.from || want.to) {
        // Left out, fromDate is today and toDate a week on, as the tool fills them in.
        const fromDate = last.fromDate ?? sydneyDate(now);
        const toDate = last.toDate ?? addDays(fromDate, 6);
        const passed =
          (!want.from || fromDate === resolveDay(want.from, now)) && (!want.to || toDate === resolveDay(want.to, now));
        const expected = { from: want.from && resolveDay(want.from, now), to: want.to && resolveDay(want.to, now) };
        results.push(check("alerts_dates", passed, `${fromDate} to ${toDate}, expected ${show(expected)}`));
      }
    }
  }

  if (expect.asksFollowUp) {
    results.push(check("asks_follow_up", output.reply.includes("?"), "reply asks no question"));
  }

  if (expect.noTools) {
    results.push(check("no_tools", output.calls.length === 0, `called ${output.calls.map((call) => call.tool).join(", ")}`));
  }

  if (expect.noRoute) {
    const found = plans.filter((call) => ((call.output as { journeys?: unknown[] } | undefined)?.journeys?.length ?? 0) > 0);
    results.push(check("no_route", found.length === 0, `planTrip returned journeys for ${show(found.map((c) => c.input))}`));
  }

  if (expect.noRouteDetails) {
    const details = output.reply.match(ROUTE_DETAIL) ?? [];
    results.push(check("no_route_details", details.length === 0, `reply mentions ${show(details)}`));
  }

  return results;
}
