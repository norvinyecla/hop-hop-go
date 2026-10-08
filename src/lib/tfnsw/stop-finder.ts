import { z } from "zod";

const STOP_FINDER_URL = "https://api.transport.nsw.gov.au/v1/tp/stop_finder";

// Only the fields we use; Zod drops the rest.
const stopFinderResponseSchema = z.object({
  locations: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        coord: z.tuple([z.number(), z.number()]).optional(),
        isBest: z.boolean().optional(),
        matchQuality: z.number().optional(),
        parent: z.object({ name: z.string() }).optional(),
      }),
    )
    .default([]),
});

export type Location = {
  id: string;
  name: string;
  type: string;
  lat?: number;
  lon?: number;
  suburb?: string;
  isBest: boolean;
};

/** Looks up stops, places and addresses matching a free-text query, best match first. */
export async function findLocations(query: string, limit = 5): Promise<Location[]> {
  const apiKey = process.env.TFNSW_API_KEY;
  if (!apiKey) {
    throw new Error("TFNSW_API_KEY is not set");
  }

  const params = new URLSearchParams({
    outputFormat: "rapidJSON",
    coordOutputFormat: "EPSG:4326",
    type_sf: "any",
    name_sf: query,
    TfNSWSF: "true",
  });

  const res = await fetch(`${STOP_FINDER_URL}?${params}`, {
    headers: { Authorization: `apikey ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`TfNSW stop_finder failed with status ${res.status}`);
  }

  const { locations } = stopFinderResponseSchema.parse(await res.json());

  return locations
    .sort((a, b) => (b.matchQuality ?? 0) - (a.matchQuality ?? 0))
    .slice(0, limit)
    .map((loc) => ({
      id: loc.id,
      name: loc.name,
      type: loc.type,
      lat: loc.coord?.[0],
      lon: loc.coord?.[1],
      suburb: loc.parent?.name,
      isBest: loc.isBest ?? false,
    }));
}
