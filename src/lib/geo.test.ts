import { describe, expect, it } from "vitest";
import { boundsOf, simplifyPath, type LngLat } from "./geo";

describe("simplifyPath", () => {
  it("drops points on a straight line", () => {
    const line: LngLat[] = [
      [151, -33.8],
      [151.001, -33.8],
      [151.002, -33.8],
      [151.003, -33.8],
    ];
    expect(simplifyPath(line)).toEqual([
      [151, -33.8],
      [151.003, -33.8],
    ]);
  });

  it("keeps corners", () => {
    const corner: LngLat[] = [
      [151, -33.8],
      [151.005, -33.8],
      [151.01, -33.8],
      [151.01, -33.805],
      [151.01, -33.81],
    ];
    expect(simplifyPath(corner)).toEqual([
      [151, -33.8],
      [151.01, -33.8],
      [151.01, -33.81],
    ]);
  });

  it("ignores wobble smaller than the tolerance", () => {
    const wobbly: LngLat[] = [
      [151, -33.8],
      [151.001, -33.80001],
      [151.002, -33.8],
    ];
    expect(simplifyPath(wobbly)).toHaveLength(2);
  });

  it("rounds to 5 decimal places", () => {
    expect(simplifyPath([[151.2062034, -33.8840241]])).toEqual([[151.2062, -33.88402]]);
  });

  it("handles empty and two-point paths", () => {
    expect(simplifyPath([])).toEqual([]);
    expect(
      simplifyPath([
        [151, -33.8],
        [151.1, -33.9],
      ]),
    ).toHaveLength(2);
  });
});

describe("boundsOf", () => {
  it("returns the box around the points", () => {
    expect(
      boundsOf([
        [151.2, -33.9],
        [151.0, -33.8],
        [151.1, -33.85],
      ]),
    ).toEqual([
      [151.0, -33.9],
      [151.2, -33.8],
    ]);
  });

  it("returns undefined for no points", () => {
    expect(boundsOf([])).toBeUndefined();
  });
});
