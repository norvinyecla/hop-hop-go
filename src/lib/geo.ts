/** A point as [longitude, latitude], the order MapLibre and GeoJSON use. */
export type LngLat = [number, number];

/** About 10 m at Sydney's latitude: finer detail than this isn't visible on a phone-sized map. */
const DEFAULT_TOLERANCE = 0.0001;

function round(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/** Distance from p to the segment a–b, in degrees. Good enough for comparing at city scale. */
function distanceToSegment(p: LngLat, a: LngLat, b: LngLat): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Drops points that don't change the line's shape by more than `tolerance` degrees
 * (Douglas–Peucker), and rounds to 5 decimal places (about 1 m). Keeps the first and last points.
 */
export function simplifyPath(points: LngLat[], tolerance = DEFAULT_TOLERANCE): LngLat[] {
  if (points.length <= 2) {
    return points.map(([lng, lat]) => [round(lng), round(lat)]);
  }

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > farthestDistance) {
        farthest = i;
        farthestDistance = d;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = true;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  return points.filter((_, i) => keep[i]).map(([lng, lat]) => [round(lng), round(lat)]);
}

/** The [[west, south], [east, north]] box around all points, or undefined if there are none. */
export function boundsOf(points: LngLat[]): [LngLat, LngLat] | undefined {
  if (points.length === 0) return undefined;
  let [west, south] = points[0];
  let [east, north] = points[0];
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}
