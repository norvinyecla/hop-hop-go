import { tool } from "ai";
import { z } from "zod";
import { PREFERENCES, rankJourneys } from "@/lib/rank";
import { fromSydney } from "@/lib/sydney-time";
import { findTrips } from "@/lib/tfnsw/trip";

const MAX_JOURNEYS = 3;

/** How far in the past a requested time may be, so "leave at 9:00" still works at 9:03. */
const PAST_GRACE_MS = 15 * 60_000;

export const planTrip = tool({
  description:
    "Find journeys between two locations, using trains, Sydney Metro, light rail and walking. " +
    "Leaves now unless `when` is given. Both IDs must come from resolveLocation. " +
    "Returns up to 3 journeys ranked best first, with times in Sydney local time (HH:mm).",
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
    when: z
      .object({
        type: z
          .enum(["depart", "arrive"])
          .describe("'depart' to leave at or after this time, 'arrive' to arrive by it"),
        // A plain pattern rather than z.iso.date(): some providers reject JSON Schema's "format: date".
        date: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
          .describe("Sydney local date, YYYY-MM-DD"),
        time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .describe("Sydney local time, 24-hour HH:mm"),
      })
      .optional()
      .describe("Only when the user gives a time to leave or arrive. Omit to leave now."),
  }),
  execute: async ({ originId, destinationId, preference, when }) => {
    if (when && fromSydney(when).getTime() < Date.now() - PAST_GRACE_MS) {
      return { when, journeys: [], error: "That time has already passed." };
    }
    try {
      const journeys = rankJourneys(await findTrips(originId, destinationId, when), preference).slice(
        0,
        MAX_JOURNEYS,
      );
      if (journeys.length === 0) {
        return {
          when,
          journeys,
          message: "No train, metro or light rail journey was found between these locations.",
        };
      }
      return { when, journeys };
    } catch (error) {
      console.error("planTrip failed", error);
      return { when, journeys: [], error: "Trip planning is unavailable right now." };
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
