import { describe, expect, it, vi } from "vitest";
import { FixtureMissError, fixtureKey, record, replay } from "./fixtures";

describe("fixtureKey", () => {
  it("ignores parameter order", () => {
    expect(fixtureKey("trip", { b: "2", a: "1" })).toBe(fixtureKey("trip", { a: "1", b: "2" }));
  });

  it("matches small rewordings of a place", () => {
    expect(fixtureKey("stop_finder", { name_sf: "Central Station" })).toBe(fixtureKey("stop_finder", { name_sf: " central " }));
    expect(fixtureKey("stop_finder", { name_sf: "Town Hall" })).not.toBe(fixtureKey("stop_finder", { name_sf: "Central" }));
  });
});

describe("record and replay", () => {
  it("replays what was recorded and notes misses", async () => {
    const live = vi.fn(async (endpoint: string) => ({ endpoint, journeys: [{ legs: [{ coords: [[1, 2]], mode: 1 }] }] }));
    const recording = record(live);
    await recording.tfnswGet("trip", { name_origin: "a" });

    const { tfnswGet, misses } = replay(recording.fixtures);
    // Leg shapes aren't kept.
    await expect(tfnswGet("trip", { name_origin: "a" })).resolves.toEqual({ endpoint: "trip", journeys: [{ legs: [{ mode: 1 }] }] });
    await expect(tfnswGet("trip", { name_origin: "b" })).rejects.toThrow(FixtureMissError);
    expect(misses).toEqual(["trip?name_origin=b"]);
  });

  it("keeps the fullest of repeated responses", async () => {
    const responses = [{ infos: [1, 2] }, { infos: [1] }];
    const recording = record(async () => responses.shift());
    await recording.tfnswGet("add_info", {});
    await recording.tfnswGet("add_info", {});
    expect(Object.values(recording.fixtures.responses)).toEqual([{ infos: [1, 2] }]);
  });
});
