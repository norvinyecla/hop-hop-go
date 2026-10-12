import { z } from "zod";
import { tfnswGet } from "./client";

// TfNSW product classes we fetch alerts for: 1 train, 2 metro, 4 light rail.
// Asking for all modes at once returns several megabytes, mostly buses.
const TRAIN = 1;
const MODES = [TRAIN, 2, 4];

// Alerts change slowly; every trip plan needs them, so don't fetch them for each one.
const CACHE_MS = 2 * 60_000;
// An incomplete set (see fetchTrainAlerts) is only kept long enough to cover one chat turn.
const INCOMPLETE_CACHE_MS = 15_000;
// How long a complete set of train alerts can stand in for an incomplete one.
const FALLBACK_MS = 30 * 60_000;
const TRAIN_ATTEMPTS = 4;
// Short responses come in streaks of a second or two, so an immediate retry often gets another.
const RETRY_DELAY_MS = 500;

// Only the fields we use; Zod drops the rest. Each alert is parsed on its own so one odd
// alert can't break the rest.
const infoSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  priority: z.string().optional(),
  subtitle: z.string().optional(),
  content: z.string().optional(),
  url: z.string().optional(),
  timestamps: z
    .object({ validity: z.array(z.object({ from: z.string(), to: z.string() })).default([]) })
    .optional(),
  affected: z
    .object({
      lines: z.array(z.object({ id: z.string(), number: z.string().optional() })).default([]),
      stops: z.array(z.object({ id: z.string() })).default([]),
    })
    .optional(),
  properties: z
    .object({
      announcementType: z.string().optional(),
      smsText: z.string().optional(),
      speechText: z.string().optional(),
    })
    .optional(),
});

const addInfoResponseSchema = z.object({
  infos: z.object({ current: z.array(z.unknown()).default([]) }).optional(),
});

export type ServiceAlert = {
  id: string;
  /** "trackwork" is planned work; anything else is a service change, such as a disruption or a lift outage. */
  kind: "trackwork" | "service change";
  /** TfNSW's alert type: "lineInfo", "routeInfo", "stopInfo" or "tripMessage". */
  type: string;
  priority: string;
  title: string;
  detail?: string;
  /** The full notice on transportnsw.info. */
  url?: string;
  /** Lines it affects, as line keys from lineKey(). */
  lineKeys: string[];
  /** The same lines for people, e.g. "T1" or "L2". */
  lines: string[];
  /** Global IDs of the stations it affects. Empty means it isn't tied to particular stations. */
  stopIds: string[];
  /** When it applies, as ISO times. */
  windows: { from: string; to: string }[];
};

/** The parts of an alert a journey shows. */
export type LegAlert = Pick<ServiceAlert, "id" | "kind" | "title" | "detail" | "url">;

/** What a leg is matched against: its line, stations and time. */
export type LegRef = {
  /** From lineKey(); not set for walking. */
  lineKey?: string;
  /** Global station IDs where the leg starts and ends. */
  boardAt?: string;
  alightAt?: string;
  /** Global station IDs of every stop on the leg, ends included. */
  stopIds: string[];
  /** ISO times the leg leaves and arrives. */
  from: string;
  to: string;
};

/**
 * A TfNSW line ID without its direction and trip parts, so alerts and trips can be compared:
 * "nsw:020T1:N:H:sj2" → "nsw:020T1:N".
 */
export function lineKey(lineId: string): string {
  return lineId.split(":").slice(0, 3).join(":");
}

/** "nsw:020T1:N:R:" → "T1", "nsw:780L2: :H:" → "L2". Falls back to the line's number, e.g. a regional service "633". */
function lineName(line: { id: string; number?: string }): string {
  const code = line.id.split(":")[1]?.match(/^\d+([A-Z]+\d*)$/)?.[1];
  return code ?? line.number ?? line.id;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " ", "#39": "'" };

/** Alert content is HTML; turn it into one line of text. */
function plainText(html: string): string {
  return html
    .replace(/<li[^>]*>/gi, " • ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (_, name: string) => ENTITIES[name])
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_DETAIL = 300;

function shorten(text: string): string {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1).trimEnd()}…` : text;
}

/** Parses one alert from add_info or a trip leg's infos. Returns undefined if it isn't usable. */
export function toAlert(raw: unknown): ServiceAlert | undefined {
  const parsed = infoSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const info = parsed.data;
  const title = info.subtitle || info.properties?.smsText;
  if (!title) return undefined;

  const lines = info.affected?.lines ?? [];
  const detail = info.properties?.speechText || (info.content ? plainText(info.content) : "");
  return {
    id: info.id,
    kind: info.properties?.announcementType === "trackwork" ? "trackwork" : "service change",
    type: info.type ?? "",
    priority: info.priority ?? "normal",
    title: title.trim(),
    detail: detail && detail !== title ? shorten(detail) : undefined,
    url: info.url || undefined,
    lineKeys: [...new Set(lines.map((line) => lineKey(line.id)))],
    lines: [...new Set(lines.map(lineName))],
    stopIds: (info.affected?.stops ?? []).map((stop) => stop.id),
    windows: info.timestamps?.validity ?? [],
  };
}

/** Whether TfNSW marks it as minor, e.g. "Opal top up may not be available". */
function isMinor(alert: ServiceAlert): boolean {
  return alert.priority === "veryLow";
}

async function fetchMode(mode: number): Promise<ServiceAlert[]> {
  const response = await tfnswGet("add_info", {
    filterPublicationStatus: "current",
    filterMOTType: String(mode),
  });
  return (addInfoResponseSchema.parse(response).infos?.current ?? []).flatMap((raw) => toAlert(raw) ?? []);
}

let lastCompleteTrains: { at: number; alerts: ServiceAlert[] } | undefined;

/**
 * About a third of TfNSW's add_info responses are cut short: they hold only a dozen live
 * trip messages, without any trackwork or station notices. Sydney Trains always has trackwork
 * published weeks ahead, so a train response without any is retried, and failing that, the
 * last complete one is used. Metro and light rail can't be checked this way.
 */
async function fetchTrainAlerts(): Promise<{ alerts: ServiceAlert[]; complete: boolean }> {
  let alerts: ServiceAlert[] = [];
  for (let attempt = 0; attempt < TRAIN_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    alerts = await fetchMode(TRAIN);
    if (alerts.some((alert) => alert.kind === "trackwork")) {
      lastCompleteTrains = { at: Date.now(), alerts };
      return { alerts, complete: true };
    }
  }
  if (lastCompleteTrains && Date.now() - lastCompleteTrains.at < FALLBACK_MS) {
    return { alerts: lastCompleteTrains.alerts, complete: true };
  }
  return { alerts, complete: false };
}

async function loadAlerts(): Promise<{ alerts: ServiceAlert[]; complete: boolean }> {
  const [trains, ...others] = await Promise.all([
    fetchTrainAlerts(),
    ...MODES.filter((mode) => mode !== TRAIN).map(fetchMode),
  ]);
  const byId = new Map<string, ServiceAlert>();
  for (const alert of [trains.alerts, ...others].flat()) {
    // Trip messages are about one service, which we can't tell apart from the rest of its
    // line, and they're often left open long after the trip. Trips carry their own instead.
    if (alert.type !== "tripMessage" && !isMinor(alert)) byId.set(alert.id, alert);
  }
  return { alerts: [...byId.values()], complete: trains.complete };
}

let cache: { at: number; result: Promise<{ alerts: ServiceAlert[]; complete: boolean }> } | undefined;

/** Current and upcoming alerts for trains, metro and light rail. */
export async function fetchAlerts(): Promise<ServiceAlert[]> {
  const now = Date.now();
  if (cache) {
    const { complete } = await cache.result.catch(() => ({ complete: false }));
    if (now - cache.at > (complete ? CACHE_MS : INCOMPLETE_CACHE_MS)) cache = undefined;
  }
  if (!cache) {
    const result = loadAlerts();
    cache = { at: now, result };
    // Don't keep a failure around for the next caller.
    result.catch(() => {
      if (cache?.result === result) cache = undefined;
    });
  }
  return (await cache.result).alerts;
}

/** Whether any of the alert's windows overlaps the time from `from` to `to` (ISO times). */
export function isActiveDuring(alert: ServiceAlert, from: string, to: string): boolean {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return alert.windows.some((w) => Date.parse(w.from) <= end && Date.parse(w.to) >= start);
}

/**
 * The alerts that apply to a leg: on its line, at its stations, while it runs.
 * Most trackwork is announced for a whole line, so it matches any leg on that line.
 */
export function alertsForLeg(alerts: ServiceAlert[], leg: LegRef): ServiceAlert[] {
  if (!leg.lineKey) return [];
  return alerts.filter((alert) => {
    if (alert.lineKeys.length > 0 && !alert.lineKeys.includes(leg.lineKey!)) return false;
    if (alert.stopIds.length > 0) {
      // A station notice (lifts, platforms) matters where you get on or off, not where you pass through.
      const stops = alert.type === "stopInfo" ? [leg.boardAt, leg.alightAt] : leg.stopIds;
      if (!stops.some((id) => id && alert.stopIds.includes(id))) return false;
    } else if (alert.lineKeys.length === 0) {
      return false;
    }
    return isActiveDuring(alert, leg.from, leg.to);
  });
}

/** Keeps the parts a journey shows, dropping repeats and minor alerts. */
export function toLegAlerts(alerts: ServiceAlert[]): LegAlert[] | undefined {
  const seen = new Set<string>();
  const result: LegAlert[] = [];
  for (const alert of alerts) {
    if (seen.has(alert.id) || isMinor(alert)) continue;
    seen.add(alert.id);
    const { id, kind, title, detail, url } = alert;
    result.push({ id, kind, title, detail, url });
  }
  return result.length > 0 ? result : undefined;
}
