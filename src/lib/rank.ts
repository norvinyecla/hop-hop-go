import type { Journey } from "./tfnsw/trip";

export const PREFERENCES = ["balanced", "fastest", "fewest-changes", "least-walking"] as const;
export type Preference = (typeof PREFERENCES)[number];

/**
 * How much each factor costs, in minutes. A journey's score is the minutes until it arrives
 * plus these penalties, so lower is better and scores read as "effective minutes".
 */
type Weights = {
  /** Per change of service. */
  perChange: number;
  /** Per kilometre walked, on top of the walking time already in the duration. */
  perWalkKm: number;
  /**
   * Per minute the journey is running behind the timetable. Times are already real-time
   * estimates, so the delay is in the arrival time; this only covers the risk that it grows,
   * and should only decide near-ties (0.1 = one minute per 10 minutes late).
   */
  perDelayMin: number;
};

const WEIGHTS: Record<Preference, Weights> = {
  balanced: { perChange: 5, perWalkKm: 10, perDelayMin: 0.1 },
  fastest: { perChange: 1, perWalkKm: 2, perDelayMin: 0.1 },
  "fewest-changes": { perChange: 30, perWalkKm: 10, perDelayMin: 0.1 },
  "least-walking": { perChange: 5, perWalkKm: 60, perDelayMin: 0.1 },
};

export function walkMeters(journey: Journey): number {
  return journey.legs.reduce((total, leg) => total + (leg.walkMeters ?? 0), 0);
}

/** Effective minutes for a journey under a preference. Lower is better. */
export function scoreJourney(journey: Journey, preference: Preference = "balanced"): number {
  const w = WEIGHTS[preference];
  return (
    // Minutes from now until arrival: waiting at home counts the same as time on the train.
    journey.waitMin +
    journey.durationMin +
    journey.changes * w.perChange +
    (walkMeters(journey) / 1000) * w.perWalkKm +
    (journey.delayMin ?? 0) * w.perDelayMin
  );
}

/**
 * Sorts journeys best first under a preference. Ties keep their original (TfNSW) order.
 * Does not change the input array.
 */
export function rankJourneys(journeys: Journey[], preference: Preference = "balanced"): Journey[] {
  return journeys
    .map((journey) => ({ journey, score: scoreJourney(journey, preference) }))
    .sort((a, b) => a.score - b.score)
    .map(({ journey }) => journey);
}
