import { tool } from "ai";
import { z } from "zod";
import { findTrips } from "@/lib/tfnsw/trip";

export const planTrip = tool({
  description:
    "Find journeys leaving now between two locations, using trains, Sydney Metro, light rail and walking. " +
    "Both IDs must come from resolveLocation. Returns up to 3 journeys in Transport for NSW's order, " +
    "with times in Sydney local time (HH:mm).",
  inputSchema: z.object({
    originId: z.string().min(1).describe("The id of the starting location, from resolveLocation"),
    destinationId: z.string().min(1).describe("The id of the destination location, from resolveLocation"),
  }),
  execute: async ({ originId, destinationId }) => {
    try {
      const journeys = await findTrips(originId, destinationId);
      if (journeys.length === 0) {
        return {
          journeys,
          message: "No train, metro or light rail journey was found between these locations.",
        };
      }
      return { journeys };
    } catch (error) {
      console.error("planTrip failed", error);
      return { journeys: [], error: "Trip planning is unavailable right now." };
    }
  },
});
