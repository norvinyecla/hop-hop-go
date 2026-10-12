import type { Leg } from "./tfnsw/trip";

// Line colours from the route_color field in TfNSW's GTFS schedule feeds (sydneytrains, metro,
// lightrail/*), checked October 2026. The trip API doesn't return them. Keys are the trip API's
// line codes: GTFS names the Metro "M", but the trip API calls it "M1".
const LINE_COLORS: Record<string, string> = {
  T1: "#F99D1C",
  T2: "#0098CD",
  T3: "#F37021",
  T4: "#005AA3",
  T5: "#C4258F",
  T6: "#7C3E21",
  T7: "#6F818E",
  T8: "#00954C",
  T9: "#D11F2F",
  M1: "#168388",
  L1: "#BE1622",
  L2: "#DD1E25",
  L3: "#781140",
  L4: "#BB2043",
  // Light rail special event services.
  LX: "#EE343F",
  BMT: "#F99D1C",
  CCN: "#D11F2F",
  SCO: "#005AA3",
  SHL: "#00954C",
  HUN: "#833134",
};

// For lines not listed above. Train (NSW TrainLink regional) and metro are from GTFS;
// light rail is a generic red, not an official colour.
const MODE_COLORS: Record<string, string> = {
  train: "#F6891F",
  metro: "#168388",
  "light rail": "#E4022D",
};

export const WALK_COLOR = "#6B7280";

export function legColor(leg: Pick<Leg, "mode" | "line">): string {
  if (leg.mode === "walk") return WALK_COLOR;
  return (leg.line && LINE_COLORS[leg.line]) || MODE_COLORS[leg.mode] || "#4B5563";
}
