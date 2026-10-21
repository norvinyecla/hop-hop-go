import { describe, expect, it } from "vitest";
import { avoidLabel, normalizeAvoid } from "./avoid";

describe("normalizeAvoid", () => {
  it("drops repeats and keeps a fixed order", () => {
    expect(normalizeAvoid(["bus", "train", "bus"])).toEqual(["train", "bus"]);
  });

  it("is undefined when there is nothing to avoid", () => {
    expect(normalizeAvoid(undefined)).toBeUndefined();
    expect(normalizeAvoid([])).toBeUndefined();
  });
});

describe("avoidLabel", () => {
  it("names trains and metro separately", () => {
    expect(avoidLabel(["train"])).toBe("trains");
    expect(avoidLabel(["metro"])).toBe("metro");
  });

  it("lists several modes", () => {
    expect(avoidLabel(["bus"])).toBe("buses");
    expect(avoidLabel(["bus", "light rail"])).toBe("light rail and buses");
    expect(avoidLabel(["bus", "metro", "train"])).toBe("trains, metro and buses");
  });
});
