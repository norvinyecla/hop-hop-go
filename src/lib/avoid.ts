/**
 * Modes a user can ask planTrip to leave out. "train" covers Sydney Metro too: avoiding either
 * avoids both. Leg cards still tell them apart (see MODE_NAMES in tfnsw/trip.ts).
 */
export const AVOIDABLE_MODES = ["train", "light rail", "bus"] as const;
export type AvoidableMode = (typeof AVOIDABLE_MODES)[number];

const NOUNS: Record<AvoidableMode, string[]> = {
  train: ["trains", "metro"],
  "light rail": ["light rail"],
  bus: ["buses"],
};

/** Each mode once, in AVOIDABLE_MODES order. Undefined when there is nothing to avoid. */
export function normalizeAvoid(avoid: readonly AvoidableMode[] | undefined): AvoidableMode[] | undefined {
  const modes = AVOIDABLE_MODES.filter((mode) => avoid?.includes(mode));
  return modes.length > 0 ? modes : undefined;
}

/** "buses", "trains and metro", "trains, metro and buses". */
export function avoidLabel(avoid: readonly AvoidableMode[]): string {
  const nouns = (normalizeAvoid(avoid) ?? []).flatMap((mode) => NOUNS[mode]);
  return nouns.length > 1 ? `${nouns.slice(0, -1).join(", ")} and ${nouns.at(-1)}` : (nouns[0] ?? "");
}
