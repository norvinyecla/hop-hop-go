import { describe, expect, it } from "vitest";
import { avoidsModes, tripParams, type Journey, type Leg } from "./trip";

function excluded(params: Record<string, string>): number[] {
  return Object.keys(params)
    .flatMap((key) => key.match(/^exclMOT_(\d+)$/)?.[1] ?? [])
    .map(Number)
    .sort((a, b) => a - b);
}

function leg(mode: string): Leg {
  return { mode, from: "A", to: "B", departs: "08:00", arrives: "08:10", durationMin: 10, path: [] };
}

function journey(...modes: string[]): Journey {
  return { departs: "08:00", arrives: "08:30", durationMin: 30, changes: modes.length - 1, legs: modes.map(leg) };
}

describe("tripParams", () => {
  it("always leaves out coach, ferry and school bus", () => {
    expect(excluded(tripParams("a", "b"))).toEqual([7, 9, 11]);
  });

  it("leaves out train and metro separately", () => {
    expect(excluded(tripParams("a", "b", { avoid: ["train"] }))).toEqual([1, 7, 9, 11]);
    expect(excluded(tripParams("a", "b", { avoid: ["metro"] }))).toEqual([2, 7, 9, 11]);
  });

  it("leaves out light rail and bus", () => {
    expect(excluded(tripParams("a", "b", { avoid: ["light rail", "bus"] }))).toEqual([4, 5, 7, 9, 11]);
  });

  it("sets the time for leave-at and arrive-by searches", () => {
    const params = tripParams("a", "b", { when: { type: "arrive", date: "2026-10-21", time: "09:05" } });
    expect(params).toMatchObject({ depArrMacro: "arr", itdDate: "20261021", itdTime: "0905" });
  });
});

describe("avoidsModes", () => {
  it("tells train and metro apart", () => {
    expect(avoidsModes(journey("walk", "metro"), ["train"])).toBe(true);
    expect(avoidsModes(journey("walk", "metro"), ["metro"])).toBe(false);
    expect(avoidsModes(journey("train"), ["metro"])).toBe(true);
    expect(avoidsModes(journey("train"), ["train"])).toBe(false);
  });

  it("checks every leg", () => {
    expect(avoidsModes(journey("train", "walk", "bus"), ["bus"])).toBe(false);
    expect(avoidsModes(journey("train", "walk", "metro"), ["bus", "light rail"])).toBe(true);
  });

  it("keeps everything when nothing is avoided", () => {
    expect(avoidsModes(journey("bus"), [])).toBe(true);
  });
});
