import { describe, expect, it } from "vitest";
import { alertsForLeg, lineKey, toAlert, toLegAlerts, type LegRef, type ServiceAlert } from "./alerts";

// Trimmed from a real add_info response.
const trackworkInfo = {
  id: "ems-79346",
  type: "lineInfo",
  priority: "normal",
  subtitle: "Buses replace trains between Cabramatta and Parramatta",
  content:
    "<div><strong>Sunday 18 October</strong></div>\n<ul>\n<li>Buses replace trains between Cabramatta and Parramatta.</li>\n<li>Allow extra travel time &amp; plan ahead.</li></ul>",
  url: "https://transportnsw.info/alerts/details#/ems-79346",
  timestamps: { validity: [{ from: "2026-10-17T15:00:00Z", to: "2026-10-18T15:00:00Z" }] },
  affected: {
    lines: [
      { id: "nsw:020T2: :H:", number: "T2 Leppington & Inner West Line" },
      { id: "nsw:020T2: :R:", number: "T2 Leppington & Inner West Line" },
    ],
  },
  properties: { announcementType: "trackwork" },
};

function alert(overrides: Partial<ServiceAlert>): ServiceAlert {
  return {
    id: "a",
    kind: "trackwork",
    type: "lineInfo",
    priority: "normal",
    title: "Buses replace trains",
    lineKeys: ["nsw:020T1:N"],
    lines: ["T1"],
    stopIds: [],
    windows: [{ from: "2026-10-17T15:00:00Z", to: "2026-10-18T15:00:00Z" }],
    ...overrides,
  };
}

// A T1 North Shore leg from Central (200060) through Town Hall (200070) to Wynyard (200080) on 18 Oct.
const leg: LegRef = {
  lineKey: "nsw:020T1:N",
  boardAt: "200060",
  alightAt: "200080",
  stopIds: ["200060", "200070", "200080"],
  from: "2026-10-18T01:00:00Z",
  to: "2026-10-18T01:10:00Z",
};

describe("lineKey", () => {
  it("drops the direction and trip parts", () => {
    expect(lineKey("nsw:020T1:N:H:sj2")).toBe("nsw:020T1:N");
    expect(lineKey("nsw:020T8: :R:")).toBe("nsw:020T8: ");
  });
});

describe("toAlert", () => {
  it("parses a trackwork notice", () => {
    expect(toAlert(trackworkInfo)).toEqual({
      id: "ems-79346",
      kind: "trackwork",
      type: "lineInfo",
      priority: "normal",
      title: "Buses replace trains between Cabramatta and Parramatta",
      detail:
        "Sunday 18 October • Buses replace trains between Cabramatta and Parramatta. • Allow extra travel time & plan ahead.",
      url: "https://transportnsw.info/alerts/details#/ems-79346",
      lineKeys: ["nsw:020T2: "],
      lines: ["T2"],
      stopIds: [],
      windows: [{ from: "2026-10-17T15:00:00Z", to: "2026-10-18T15:00:00Z" }],
    });
  });

  it("prefers the spoken text, and names lines without a code by number", () => {
    const parsed = toAlert({
      ...trackworkInfo,
      affected: { lines: [{ id: "nsw:76631: :H:", number: "631" }] },
      properties: { announcementType: "serviceChange", speechText: "This service is a coach." },
    });
    expect(parsed?.kind).toBe("service change");
    expect(parsed?.detail).toBe("This service is a coach.");
    expect(parsed?.lines).toEqual(["631"]);
  });

  it("rejects alerts it can't use", () => {
    expect(toAlert({ subtitle: "No id" })).toBeUndefined();
    expect(toAlert({ id: "x" })).toBeUndefined();
  });
});

describe("alertsForLeg", () => {
  it("matches line-wide trackwork while the leg runs", () => {
    expect(alertsForLeg([alert({})], leg)).toHaveLength(1);
  });

  it("ignores other lines, other times and walking", () => {
    expect(alertsForLeg([alert({ lineKeys: ["nsw:020T1:W"] })], leg)).toEqual([]);
    expect(
      alertsForLeg([alert({ windows: [{ from: "2026-10-23T15:00:00Z", to: "2026-10-25T15:00:00Z" }] })], leg),
    ).toEqual([]);
    expect(alertsForLeg([alert({})], { ...leg, lineKey: undefined })).toEqual([]);
  });

  it("matches a route notice anywhere along the leg", () => {
    expect(alertsForLeg([alert({ type: "routeInfo", stopIds: ["200070"] })], leg)).toHaveLength(1);
    expect(alertsForLeg([alert({ type: "routeInfo", stopIds: ["207720"] })], leg)).toEqual([]);
  });

  it("matches a station notice only where you get on or off", () => {
    expect(alertsForLeg([alert({ type: "stopInfo", stopIds: ["200080"] })], leg)).toHaveLength(1);
    expect(alertsForLeg([alert({ type: "stopInfo", stopIds: ["200070"] })], leg)).toEqual([]);
  });

  it("matches a station notice without lines for any line", () => {
    expect(alertsForLeg([alert({ type: "stopInfo", lineKeys: [], stopIds: ["200060"] })], leg)).toHaveLength(1);
  });
});

describe("toLegAlerts", () => {
  it("drops repeats and minor alerts", () => {
    const alerts = [alert({ id: "a" }), alert({ id: "a" }), alert({ id: "b", priority: "veryLow" })];
    expect(toLegAlerts(alerts)?.map((a) => a.id)).toEqual(["a"]);
  });

  it("is undefined when nothing is left", () => {
    expect(toLegAlerts([])).toBeUndefined();
  });
});
