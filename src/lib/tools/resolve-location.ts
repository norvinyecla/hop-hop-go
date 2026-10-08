import { tool } from "ai";
import { z } from "zod";
import { findLocations } from "@/lib/tfnsw/stop-finder";

export const resolveLocation = tool({
  description:
    "Turn a place name, stop, landmark or address into matching locations from Transport for NSW. " +
    "Returns up to 5 candidates, best match first. A candidate with isBest=true is TfNSW's confident match. " +
    "If no candidate is clearly right, ask the user which one they meant.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe('The place as the user described it, e.g. "Central Station", "Manly Wharf", "Sydney Opera House"'),
  }),
  execute: async ({ query }) => {
    try {
      const candidates = await findLocations(query);
      return { query, candidates };
    } catch (error) {
      console.error("resolveLocation failed", error);
      return { query, candidates: [], error: "Location lookup is unavailable right now." };
    }
  },
});
