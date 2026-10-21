import { z } from "zod";
import type { AvoidableMode } from "@/lib/avoid";
import { simplifyPath, type LngLat } from "@/lib/geo";
import { dayLabel, fromSydney, toSydney, type SydneyDateTime } from "@/lib/sydney-time";
import { alertsForLeg, fetchAlerts, lineKey, toAlert, toLegAlerts, type LegAlert, type ServiceAlert } from "./alerts";
import { tfnswGet } from "./client";

// TfNSW product classes we ask the trip planner to leave out:
// 7 coach, 9 ferry, 11 school bus.
const EXCLUDED_MODES = [7, 9, 11];

// The product class behind each mode a user can avoid.
const AVOIDABLE_CLASSES: Record<AvoidableMode, number> = {
  train: 1,
  metro: 2,
  "light rail": 4,
  bus: 5,
};

const MODE_NAMES: Record<number, string> = {
  1: "train",
  2: "metro",
  4: "light rail",
  5: "bus",
  99: "walk",
  100: "walk",
};

// Only the fields we use; Zod drops the rest.
const stopSchema = z.object({
  name: z.string(),
  /** [lat, lon] */
  coord: z.array(z.number()).length(2).optional(),
  properties: z.object({ platformName: z.string().optional() }).optional(),
  /** The station a platform belongs to, by its global stop ID. */
  parent: z.object({ id: z.string() }).optional(),
  departureTimePlanned: z.string().optional(),
  departureTimeEstimated: z.string().optional(),
  arrivalTimePlanned: z.string().optional(),
  arrivalTimeEstimated: z.string().optional(),
});

const tripResponseSchema = z.object({
  journeys: z
    .array(
      z.object({
        interchanges: z.number().optional(),
        legs: z
          .array(
            z.object({
              duration: z.number().optional(),
              distance: z.number().optional(),
              /** The leg's path as [lat, lon] points. */
              coords: z.array(z.array(z.number()).length(2)).optional(),
              origin: stopSchema,
              destination: stopSchema,
              stopSequence: z.array(z.object({ parent: z.object({ id: z.string() }).optional() })).optional(),
              /** Alerts TfNSW attached to this leg; parsed one by one with toAlert. */
              infos: z.array(z.unknown()).optional(),
              transportation: z
                .object({
                  id: z.string().optional(),
                  disassembledName: z.string().optional(),
                  product: z.object({ class: z.number(), name: z.string().optional() }).optional(),
                  destination: z.object({ name: z.string() }).optional(),
                })
                .optional(),
            }),
          )
          .min(1),
      }),
    )
    .default([]),
});

export type Leg = {
  mode: string;
  /** Line code, e.g. "T1" or "L2". Not set for walking. */
  line?: string;
  /** Where the service is heading, as shown on the vehicle. */
  towards?: string;
  from: string;
  to: string;
  /** Platform or bus stand the service leaves from, e.g. "Platform 3" or "Stand B". Not set for walking or light rail. */
  platform?: string;
  /** Platform the service arrives at. */
  arrivalPlatform?: string;
  /** Sydney local time, HH:mm. */
  departs: string;
  arrives: string;
  durationMin: number;
  /** Minutes behind the timetable, from real-time data. */
  delayMin?: number;
  walkMeters?: number;
  /** Trackwork and service changes on this leg's line or stations while it runs. */
  alerts?: LegAlert[];
  /** The leg's path for the map, as [lng, lat] points. Kept out of the model's context. */
  path: LngLat[];
};

/** Leave at, or arrive by, a Sydney local time. Searches without one leave now. */
export type TripTime = SydneyDateTime & { type: "depart" | "arrive" };

export type Journey = {
  departs: string;
  arrives: string;
  /** The day the journey leaves, e.g. "Tue, 13 Oct". Only set when that isn't today. */
  day?: string;
  /** From leaving the first stop to arriving at the last; excludes waitMin. */
  durationMin: number;
  /**
   * Minutes from the requested time (now, or the leave-at time) until the journey starts.
   * Not set for arrive-by searches.
   */
  waitMin?: number;
  /**
   * For arrive-by searches: minutes between arriving and the arrive-by time.
   * Negative when real-time data says it will arrive late.
   */
  spareMin?: number;
  /**
   * Minutes behind the timetable at the destination, from real-time data. A late first
   * service often just shortens the wait for the next, so this is not the sum of leg delays.
   */
  delayMin?: number;
  changes: number;
  legs: Leg[];
};

export type TripOptions = {
  /** Leave at or arrive by this time. Leaves now when not set. */
  when?: TripTime;
  /** Modes to leave out, on top of coach, ferry and school bus. */
  avoid?: readonly AvoidableMode[];
  /** How many journeys to ask TfNSW for. */
  count?: number;
};

/** The trip API's query parameters for a search. */
export function tripParams(
  originId: string,
  destinationId: string,
  { when, avoid = [], count = 6 }: TripOptions = {},
): Record<string, string> {
  const params: Record<string, string> = {
    depArrMacro: when?.type === "arrive" ? "arr" : "dep",
    type_origin: "any",
    name_origin: originId,
    type_destination: "any",
    name_destination: destinationId,
    calcNumberOfTrips: String(count),
    TfNSWTR: "true",
    excludedMeans: "checkbox",
  };
  if (when) {
    params.itdDate = when.date.replaceAll("-", "");
    params.itdTime = when.time.replace(":", "");
  }
  for (const mode of [...EXCLUDED_MODES, ...avoid.map((name) => AVOIDABLE_CLASSES[name])]) {
    params[`exclMOT_${mode}`] = "1";
  }
  return params;
}

/** Whether a journey has no leg in an avoided mode. */
export function avoidsModes(journey: Journey, avoid: readonly AvoidableMode[]): boolean {
  const modes = new Set(avoid.map((name) => MODE_NAMES[AVOIDABLE_CLASSES[name]]));
  return journey.legs.every((leg) => !modes.has(leg.mode));
}

function toSydneyTime(iso: string): string {
  return toSydney(new Date(iso)).time;
}

type Stop = z.infer<typeof stopSchema>;

/**
 * The stop's platform, such as "Platform 3", or bus stand, such as "Stand B". Light rail and most
 * bus stops use their own name instead. A bus stand ends the name, e.g. "Manly Wharf, West Esplanade, Stand B".
 */
function platformOf(stop: Stop): string | undefined {
  const name = stop.properties?.platformName;
  if (!name) return undefined;
  if (/^platform\b/i.test(name)) return name;
  return name.match(/\bStand [A-Z0-9]+$/i)?.[0];
}

/** "Central Station, Platform 16, Sydney" → "Central Station, Sydney" when the platform is reported separately. */
function stopName(stop: Stop): string {
  const platform = platformOf(stop);
  return platform ? stop.name.replace(`, ${platform}`, "") : stop.name;
}

function toLngLat([lat, lon]: number[]): LngLat {
  return [lon, lat];
}

function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
}

async function fetchAlertsOrNone(): Promise<ServiceAlert[]> {
  try {
    return await fetchAlerts();
  } catch (error) {
    // Journeys are still worth showing without alerts.
    console.error("fetchAlerts failed", error);
    return [];
  }
}

/**
 * Finds journeys between two TfNSW location IDs (from findLocations), leaving now or at/by
 * `when`, using trains, metro, light rail, buses and walking only, minus any modes in `avoid`.
 * Journeys keep TfNSW's order.
 */
export async function findTrips(
  originId: string,
  destinationId: string,
  options: TripOptions = {},
  signal?: AbortSignal,
): Promise<Journey[]> {
  const { when, avoid = [] } = options;
  const now = new Date();
  const requestedAt = (when ? fromSydney(when) : now).toISOString();
  const today = toSydney(now).date;
  const params = tripParams(originId, destinationId, options);

  // Alerts are shared between requests (see fetchAlerts), so one client leaving mustn't cancel them.
  const [data, alerts] = await Promise.all([tfnswGet("trip", params, signal), fetchAlertsOrNone()]);
  const { journeys } = tripResponseSchema.parse(data);

  const found = journeys.map((journey): Journey => {
    const legs = journey.legs.map((leg): Leg => {
      const productClass = leg.transportation?.product?.class;
      const mode =
        (productClass !== undefined && MODE_NAMES[productClass]) ||
        leg.transportation?.product?.name ||
        "unknown";
      const departPlanned = leg.origin.departureTimePlanned;
      const departActual = leg.origin.departureTimeEstimated ?? departPlanned;
      const arriveActual = leg.destination.arrivalTimeEstimated ?? leg.destination.arrivalTimePlanned;
      const delayMin =
        departPlanned && departActual ? minutesBetween(departPlanned, departActual) : 0;

      const walking = mode === "walk";
      const ends = [leg.origin.coord, leg.destination.coord].filter((c) => c !== undefined);
      const path = simplifyPath((leg.coords?.length ? leg.coords : ends).map(toLngLat));

      const lineId = walking ? undefined : leg.transportation?.id;
      const matched =
        departActual && arriveActual
          ? alertsForLeg(alerts, {
              lineKey: lineId && lineKey(lineId),
              boardAt: leg.origin.parent?.id,
              alightAt: leg.destination.parent?.id,
              stopIds: (leg.stopSequence ?? []).flatMap((stop) => (stop.parent ? [stop.parent.id] : [])),
              from: departActual,
              to: arriveActual,
            })
          : [];
      const attached = (leg.infos ?? []).flatMap((info) => toAlert(info) ?? []);

      return {
        mode,
        line: walking ? undefined : leg.transportation?.disassembledName,
        towards: walking ? undefined : leg.transportation?.destination?.name,
        from: stopName(leg.origin),
        to: stopName(leg.destination),
        platform: walking ? undefined : platformOf(leg.origin),
        arrivalPlatform: walking ? undefined : platformOf(leg.destination),
        departs: departActual ? toSydneyTime(departActual) : "",
        arrives: arriveActual ? toSydneyTime(arriveActual) : "",
        durationMin: Math.round((leg.duration ?? 0) / 60),
        delayMin: delayMin > 0 ? delayMin : undefined,
        walkMeters: walking ? leg.distance : undefined,
        alerts: toLegAlerts([...attached, ...matched]),
        path,
      };
    });

    const first = journey.legs[0].origin;
    const last = journey.legs[journey.legs.length - 1].destination;
    const start = first.departureTimeEstimated ?? first.departureTimePlanned;
    const end = last.arrivalTimeEstimated ?? last.arrivalTimePlanned;
    const delayMin =
      last.arrivalTimePlanned && end ? minutesBetween(last.arrivalTimePlanned, end) : 0;

    const arriving = when?.type === "arrive";
    const startDate = start ? new Date(start) : undefined;

    return {
      departs: legs[0].departs,
      arrives: legs[legs.length - 1].arrives,
      day: startDate && toSydney(startDate).date !== today ? dayLabel(startDate) : undefined,
      durationMin: start && end ? minutesBetween(start, end) : 0,
      waitMin: arriving ? undefined : start ? Math.max(0, minutesBetween(requestedAt, start)) : 0,
      spareMin: arriving && end ? minutesBetween(end, requestedAt) : undefined,
      delayMin: delayMin > 0 ? delayMin : undefined,
      changes: journey.interchanges ?? 0,
      legs,
    };
  });
  // The exclMOT flags should already leave these out; this keeps the promise if TfNSW slips one through.
  return found.filter((journey) => avoidsModes(journey, avoid));
}
