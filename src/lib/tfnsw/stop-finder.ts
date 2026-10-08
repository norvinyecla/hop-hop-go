import { z } from "zod";
import { tfnswGet } from "./client";

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
  const data = await tfnswGet("stop_finder", {
    type_sf: "any",
    name_sf: query,
    TfNSWSF: "true",
  });

  const { locations } = stopFinderResponseSchema.parse(data);

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
