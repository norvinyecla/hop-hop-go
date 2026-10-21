import { tool } from "ai";
import { z } from "zod";
import { AVOIDABLE_MODES, avoidLabel, normalizeAvoid } from "@/lib/avoid";
import { PREFERENCES, rankJourneys } from "@/lib/rank";
import { fromSydney } from "@/lib/sydney-time";
import { findTrips } from "@/lib/tfnsw/trip";

const MAX_JOURNEYS = 3;

// At least one mode has to stay in.
const avoidSchema = z.array(z.enum(AVOIDABLE_MODES)).min(1).max(AVOIDABLE_MODES.length - 1);

// A plain pattern rather than z.iso.date(): some providers reject JSON Schema's "format: date".
const sydneyDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const sydneyTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const legAlertSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["trackwork", "service change"]),
  title: z.string(),
  detail: z.string().optional(),
  url: z.string().optional(),
});

const legSchema = z.strictObject({
  mode: z.string(),
  line: z.string().optional(),
  towards: z.string().optional(),
  from: z.string(),
  to: z.string(),
  platform: z.string().optional(),
  arrivalPlatform: z.string().optional(),
  departs: sydneyTimeSchema,
  arrives: sydneyTimeSchema,
  durationMin: z.number(),
  delayMin: z.number().optional(),
  walkMeters: z.number().optional(),
  alerts: z.array(legAlertSchema).optional(),
  path: z.array(z.tuple([z.number(), z.number()])),
});

const journeySchema = z.strictObject({
  departs: sydneyTimeSchema,
  arrives: sydneyTimeSchema,
  day: z.string().optional(),
  durationMin: z.number(),
  waitMin: z.number().optional(),
  spareMin: z.number().optional(),
  delayMin: z.number().optional(),
  changes: z.number().int().nonnegative(),
  legs: z.array(legSchema).min(1),
});

/** How far in the past a requested time may be, so "leave at 9:00" still works at 9:03. */
const PAST_GRACE_MS = 15 * 60_000;

export const planTrip = tool({
  description:
    "Find journeys between two locations, using trains, Sydney Metro, light rail, buses and walking. " +
    "Leaves now unless `when` is given. Both IDs must come from resolveLocation. " +
    "Returns up to 3 journeys ranked best first, with times in Sydney local time (HH:mm). " +
    "Legs may list alerts: trackwork or service changes on that line or at its stations while the leg runs. " +
    "Bus legs only list alerts TfNSW attaches to the trip itself. " +
    "Pass `avoid` to leave modes out.",
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
        date: sydneyDateSchema.describe("Sydney local date, YYYY-MM-DD"),
        time: sydneyTimeSchema.describe("Sydney local time, 24-hour HH:mm"),
      })
      .optional()
      .describe("Only when the user gives a time to leave or arrive. Omit to leave now."),
    avoid: avoidSchema
      .optional()
      .describe(
        "Modes to leave out, only when the user asks not to use them. 'train' is Sydney Trains and NSW TrainLink; " +
          "'metro' is Sydney Metro. " +
          "At least one mode must stay in. Omit to allow every mode.",
      ),
  }),
  // Lets validateUIMessages reject malformed results in the history a client sends back.
  outputSchema: z.strictObject({
    when: z
      .strictObject({ type: z.enum(["depart", "arrive"]), date: sydneyDateSchema, time: sydneyTimeSchema })
      .optional(),
    avoid: avoidSchema.optional(),
    journeys: z.array(journeySchema).max(MAX_JOURNEYS),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ originId, destinationId, preference, when, avoid: requested }, { abortSignal }) => {
    // Echoed back so the UI can show it and the model can keep it for later trips in the chat.
    const avoid = normalizeAvoid(requested);
    if (when && fromSydney(when).getTime() < Date.now() - PAST_GRACE_MS) {
      return { when, avoid, journeys: [], error: "That time has already passed." };
    }
    try {
      const found = await findTrips(originId, destinationId, { when, avoid }, abortSignal);
      const journeys = rankJourneys(found, preference).slice(0, MAX_JOURNEYS);
      if (journeys.length === 0) {
        return {
          when,
          avoid,
          journeys,
          message: avoid
            ? `No journey avoiding ${avoidLabel(avoid)} was found between these locations.`
            : "No train, metro, light rail or bus journey was found between these locations.",
        };
      }
      return { when, avoid, journeys };
    } catch (error) {
      // The client left; nobody will see the result.
      if (abortSignal?.aborted) throw error;
      console.error("planTrip failed", error);
      return { when, avoid, journeys: [], error: "Trip planning is unavailable right now." };
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
