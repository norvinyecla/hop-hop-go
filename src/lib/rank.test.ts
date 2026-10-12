import { describe, expect, it } from "vitest";
import { rankJourneys, scoreJourney } from "./rank";
import type { Journey, Leg } from "./tfnsw/trip";

function walk(meters: number): Leg {
  return {
    mode: "walk",
    from: "A",
    to: "B",
    departs: "08:00",
    arrives: "08:05",
    durationMin: Math.round(meters / 80),
    walkMeters: meters,
    path: [],
  };
}

function ride(delayMin?: number): Leg {
  return {
    mode: "train",
    line: "T1",
    from: "B",
    to: "C",
    departs: "08:05",
    arrives: "08:25",
    durationMin: 20,
    delayMin,
    path: [],
  };
}

function journey(overrides: Partial<Journey> & { id: string }): Journey & { id: string } {
  return {
    departs: "08:00",
    arrives: "08:30",
    durationMin: 30,
    waitMin: 0,
    changes: 0,
    legs: [ride()],
    ...overrides,
  };
}

const ids = (journeys: Journey[]) => journeys.map((j) => (j as Journey & { id: string }).id);

describe("scoreJourney", () => {
  it("is the duration when there are no penalties", () => {
    expect(scoreJourney(journey({ id: "a", durationMin: 27 }))).toBe(27);
  });

  it("adds penalties for changes, walking, waiting and delays", () => {
    const plain = journey({ id: "plain" });
    expect(scoreJourney(journey({ id: "x", changes: 1 }))).toBeGreaterThan(scoreJourney(plain));
    expect(scoreJourney(journey({ id: "x", legs: [walk(500), ride()] }))).toBeGreaterThan(
      scoreJourney(plain),
    );
    expect(scoreJourney(journey({ id: "x", waitMin: 6 }))).toBeGreaterThan(scoreJourney(plain));
    expect(scoreJourney(journey({ id: "x", legs: [ride(4)] }))).toBeGreaterThan(scoreJourney(plain));
  });

  it("defaults to the balanced preference", () => {
    const j = journey({ id: "a", changes: 2, legs: [walk(800), ride(3)], waitMin: 4 });
    expect(scoreJourney(j)).toBe(scoreJourney(j, "balanced"));
  });
});

describe("rankJourneys", () => {
  it("puts the quickest journey first when nothing else differs", () => {
    const ranked = rankJourneys([
      journey({ id: "slow", durationMin: 40 }),
      journey({ id: "quick", durationMin: 25 }),
      journey({ id: "mid", durationMin: 32 }),
    ]);
    expect(ids(ranked)).toEqual(["quick", "mid", "slow"]);
  });

  it("prefers a slightly slower direct trip over one with changes", () => {
    const ranked = rankJourneys([
      journey({ id: "two-changes", durationMin: 30, changes: 2 }),
      journey({ id: "direct", durationMin: 34 }),
    ]);
    expect(ids(ranked)).toEqual(["direct", "two-changes"]);
  });

  it("still picks a much faster trip with a change", () => {
    const ranked = rankJourneys([
      journey({ id: "direct", durationMin: 55 }),
      journey({ id: "one-change", durationMin: 35, changes: 1 }),
    ]);
    expect(ids(ranked)).toEqual(["one-change", "direct"]);
  });

  it("puts a delayed service behind an otherwise equal one", () => {
    const ranked = rankJourneys([
      journey({ id: "delayed", legs: [ride(5)] }),
      journey({ id: "on-time" }),
    ]);
    expect(ids(ranked)).toEqual(["on-time", "delayed"]);
  });

  it("puts a long wait behind an otherwise equal journey", () => {
    const ranked = rankJourneys([journey({ id: "later", waitMin: 12 }), journey({ id: "soon" })]);
    expect(ids(ranked)).toEqual(["soon", "later"]);
  });

  describe("preferences", () => {
    const fastWithChanges = journey({ id: "fast-changes", durationMin: 30, changes: 2 });
    const slowDirect = journey({ id: "slow-direct", durationMin: 45 });
    const fastWalky = journey({ id: "fast-walky", durationMin: 28, legs: [walk(1500), ride()] });
    const slowNoWalk = journey({ id: "slow-no-walk", durationMin: 40 });

    it("fastest favours journey time over changes", () => {
      expect(ids(rankJourneys([slowDirect, fastWithChanges], "fastest"))[0]).toBe("fast-changes");
    });

    it("fewest-changes favours the direct trip", () => {
      expect(ids(rankJourneys([fastWithChanges, slowDirect], "fewest-changes"))[0]).toBe(
        "slow-direct",
      );
    });

    it("fastest tolerates walking", () => {
      expect(ids(rankJourneys([slowNoWalk, fastWalky], "fastest"))[0]).toBe("fast-walky");
    });

    it("least-walking favours the trip with less walking", () => {
      expect(ids(rankJourneys([fastWalky, slowNoWalk], "least-walking"))[0]).toBe("slow-no-walk");
    });
  });

  it("keeps the original order for ties", () => {
    const ranked = rankJourneys([journey({ id: "first" }), journey({ id: "second" })]);
    expect(ids(ranked)).toEqual(["first", "second"]);
  });

  it("does not change the input array", () => {
    const input = [journey({ id: "slow", durationMin: 40 }), journey({ id: "quick", durationMin: 20 })];
    rankJourneys(input);
    expect(ids(input)).toEqual(["slow", "quick"]);
  });

  it("handles an empty list", () => {
    expect(rankJourneys([])).toEqual([]);
  });
});
