import type { Journey } from "./tfnsw/trip";

export const PREFERENCES = ["balanced", "fastest", "fewest-changes", "least-walking"] as const;
export type Preference = (typeof PREFERENCES)[number];

/**
 * How much each factor costs, in minutes of travel time. A journey's score is its
 * duration plus these penalties, so lower is better and scores read as "effective minutes".
 */
type Weights = {
  /** Per change of service. */
  perChange: number;
  /** Per kilometre walked, on top of the walking time already in the duration. */
  perWalkKm: number;
  /** Per minute spent waiting before the journey starts. */
  perWaitMin: number;
  /** Per minute of real-time delay, for the risk that it gets worse. */
  perDelayMin: number;
};

const WEIGHTS: Record<Preference, Weights> = {
  balanced: { perChange: 5, perWalkKm: 10, perWaitMin: 0.5, perDelayMin: 0.5 },
  fastest: { perChange: 1, perWalkKm: 2, perWaitMin: 1, perDelayMin: 0.5 },
  "fewest-changes": { perChange: 30, perWalkKm: 10, perWaitMin: 0.5, perDelayMin: 0.5 },
  "least-walking": { perChange: 5, perWalkKm: 60, perWaitMin: 0.5, perDelayMin: 0.5 },
};

export function walkMeters(journey: Journey): number {
  return journey.legs.reduce((total, leg) => total + (leg.walkMeters ?? 0), 0);
}

function delayMin(journey: Journey): number {
  return journey.legs.reduce((total, leg) => total + (leg.delayMin ?? 0), 0);
}

/** Effective minutes for a journey under a preference. Lower is better. */
export function scoreJourney(journey: Journey, preference: Preference = "balanced"): number {
  const w = WEIGHTS[preference];
  return (
    journey.durationMin +
    journey.changes * w.perChange +
    (walkMeters(journey) / 1000) * w.perWalkKm +
    journey.waitMin * w.perWaitMin +
    delayMin(journey) * w.perDelayMin
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
