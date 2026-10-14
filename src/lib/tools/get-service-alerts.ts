import { tool } from "ai";
import { z } from "zod";
import { addDays, startOfSydneyDay, sydneyDate } from "@/lib/sydney-time";
import { fetchAlerts, isActiveDuring, type ServiceAlert } from "@/lib/tfnsw/alerts";

const MAX_ALERTS = 20;
const MAX_WINDOWS = 3;
const MAX_DAYS = 14;
const DAY_MS = 24 * 60 * 60_000;

const sydneyDateTime = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function sydney(iso: string): string {
  return sydneyDateTime.format(new Date(iso));
}

/** "Sat 17 Oct, 02:00 – Sun 18 Oct, 02:00", or "from …" for notices with no planned end. */
function windowLabel({ from, to }: { from: string; to: string }): string {
  // TfNSW marks open-ended notices with an end in the year 2500.
  return Date.parse(to) - Date.parse(from) > 365 * DAY_MS
    ? `from ${sydney(from)}, until further notice`
    : `${sydney(from)} – ${sydney(to)}`;
}

function firstStart(alert: ServiceAlert, from: number): number {
  return Math.max(from, Math.min(...alert.windows.map((w) => Date.parse(w.from))));
}

export const getServiceAlerts = tool({
  description:
    "List trackwork and service changes for Sydney Trains, Sydney Metro and light rail from Transport for NSW, " +
    "between two dates, up to 14 days apart. Times are Sydney local time. " +
    "Use it when the user asks about trackwork, disruptions or changes on a line, or about travel on a later day.",
  inputSchema: z.object({
    lines: z
      .array(z.string().min(1))
      .max(10)
      .default([])
      .describe('Line codes such as "T1", "M1" or "L2". Leave empty for every line.'),
    fromDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("First day to check, YYYY-MM-DD in Sydney. Leave out for today."),
    toDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Last day to check, YYYY-MM-DD in Sydney. Leave out for a week from fromDate."),
  }),
  // Lets validateUIMessages reject malformed results in the history a client sends back.
  outputSchema: z.strictObject({
    total: z.number().int().nonnegative(),
    alerts: z
      .array(
        z.strictObject({
          kind: z.enum(["trackwork", "service change"]),
          title: z.string(),
          detail: z.string().optional(),
          lines: z.array(z.string()),
          when: z.array(z.string()).max(MAX_WINDOWS),
          url: z.string().optional(),
        }),
      )
      .max(MAX_ALERTS),
    error: z.string().optional(),
  }),
  execute: async ({ lines, fromDate, toDate }) => {
    const now = new Date();
    const firstDay = fromDate ?? sydneyDate(now);
    const lastDay = toDate ?? addDays(firstDay, 6);
    const start = new Date(Math.max(now.getTime(), startOfSydneyDay(firstDay).getTime()));
    const end = startOfSydneyDay(addDays(lastDay, 1));
    if (end <= start || end.getTime() - start.getTime() > (MAX_DAYS + 1) * DAY_MS) {
      return { total: 0, alerts: [], error: `Pick dates from today onwards, at most ${MAX_DAYS} days apart.` };
    }
    const from = start.toISOString();
    const to = end.toISOString();
    const wanted = lines.map((line) => line.trim().toUpperCase());
    try {
      const matching = (await fetchAlerts())
        .filter((alert) => isActiveDuring(alert, from, to))
        .filter((alert) => wanted.length === 0 || alert.lines.some((line) => wanted.includes(line.toUpperCase())))
        .sort((a, b) => firstStart(a, start.getTime()) - firstStart(b, start.getTime()));
      return {
        total: matching.length,
        alerts: matching.slice(0, MAX_ALERTS).map((alert) => ({
          kind: alert.kind,
          title: alert.title,
          detail: alert.detail,
          lines: alert.lines,
          when: alert.windows
            .filter((w) => Date.parse(w.to) >= start.getTime() && Date.parse(w.from) <= end.getTime())
            .slice(0, MAX_WINDOWS)
            .map(windowLabel),
          url: alert.url,
        })),
      };
    } catch (error) {
      console.error("getServiceAlerts failed", error);
      return { total: 0, alerts: [], error: "Service alerts are unavailable right now." };
    }
  },
});
