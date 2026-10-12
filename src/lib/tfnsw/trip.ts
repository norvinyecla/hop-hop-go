import { z } from "zod";
import { simplifyPath, type LngLat } from "@/lib/geo";
import { tfnswGet } from "./client";

// TfNSW product classes we ask the trip planner to leave out:
// 5 bus, 7 coach, 9 ferry, 11 school bus.
const EXCLUDED_MODES = [5, 7, 9, 11];

const MODE_NAMES: Record<number, string> = {
  1: "train",
  2: "metro",
  4: "light rail",
  99: "walk",
  100: "walk",
};

// Only the fields we use; Zod drops the rest.
const stopSchema = z.object({
  name: z.string(),
  /** [lat, lon] */
  coord: z.array(z.number()).length(2).optional(),
  properties: z.object({ platformName: z.string().optional() }).optional(),
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
              transportation: z
                .object({
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
  /** Platform the service leaves from, e.g. "Platform 3". Not set for walking or light rail. */
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
  /** The leg's path for the map, as [lng, lat] points. Kept out of the model's context. */
  path: LngLat[];
};

export type Journey = {
  departs: string;
  arrives: string;
  /** From leaving the first stop to arriving at the last; excludes waitMin. */
  durationMin: number;
  /** Minutes from the request until the journey starts. */
  waitMin: number;
  changes: number;
  legs: Leg[];
};

const sydneyTime = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toSydneyTime(iso: string): string {
  return sydneyTime.format(new Date(iso));
}

type Stop = z.infer<typeof stopSchema>;

/** The stop's platform, if it has one such as "Platform 3". Light rail stops use their own name instead. */
function platformOf(stop: Stop): string | undefined {
  const name = stop.properties?.platformName;
  return name && /^platform\b/i.test(name) ? name : undefined;
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

/**
 * Finds journeys leaving now between two TfNSW location IDs (from findLocations),
 * using trains, metro, light rail and walking only. Journeys keep TfNSW's order.
 */
export async function findTrips(
  originId: string,
  destinationId: string,
  count = 6,
): Promise<Journey[]> {
  const requestedAt = new Date().toISOString();
  const params: Record<string, string> = {
    depArrMacro: "dep",
    type_origin: "any",
    name_origin: originId,
    type_destination: "any",
    name_destination: destinationId,
    calcNumberOfTrips: String(count),
    TfNSWTR: "true",
    excludedMeans: "checkbox",
  };
  for (const mode of EXCLUDED_MODES) {
    params[`exclMOT_${mode}`] = "1";
  }

  const { journeys } = tripResponseSchema.parse(await tfnswGet("trip", params));

  return journeys.map((journey) => {
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
        path,
      };
    });

    const first = journey.legs[0].origin;
    const last = journey.legs[journey.legs.length - 1].destination;
    const start = first.departureTimeEstimated ?? first.departureTimePlanned;
    const end = last.arrivalTimeEstimated ?? last.arrivalTimePlanned;

    return {
      departs: legs[0].departs,
      arrives: legs[legs.length - 1].arrives,
      durationMin: start && end ? minutesBetween(start, end) : 0,
      waitMin: start ? Math.max(0, minutesBetween(requestedAt, start)) : 0,
      changes: journey.interchanges ?? 0,
      legs,
    };
  });
}
