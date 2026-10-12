import { tool } from "ai";
import { z } from "zod";
import { PREFERENCES, rankJourneys } from "@/lib/rank";
import { findTrips } from "@/lib/tfnsw/trip";

const MAX_JOURNEYS = 3;

export const planTrip = tool({
  description:
    "Find journeys leaving now between two locations, using trains, Sydney Metro, light rail and walking. " +
    "Both IDs must come from resolveLocation. Returns up to 3 journeys ranked best first, " +
    "with times in Sydney local time (HH:mm). Legs may list alerts: trackwork or service changes on that line " +
    "or at its stations while the leg runs.",
  inputSchema: z.object({
    originId: z.string().min(1).describe("The id of the starting location, from resolveLocation"),
    destinationId: z.string().min(1).describe("The id of the destination location, from resolveLocation"),
    preference: z
      .enum(PREFERENCES)
      .default("balanced")
      .describe(
        "How to rank journeys. Use 'fastest', 'fewest-changes' or 'least-walking' only when the user asks for that; " +
          "otherwise 'balanced'.",
      ),
  }),
  execute: async ({ originId, destinationId, preference }) => {
    try {
      const journeys = rankJourneys(await findTrips(originId, destinationId), preference).slice(
        0,
        MAX_JOURNEYS,
      );
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
  // Map paths are for the UI only; they would cost the model thousands of tokens.
  toModelOutput: ({ output }) => ({
    type: "json",
    value: {
      ...output,
      journeys: output.journeys.map((journey) => ({
        ...journey,
        legs: journey.legs.map((leg) => ({ ...leg, path: undefined })),
      })),
    },
  }),
});
