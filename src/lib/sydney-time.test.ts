import { describe, expect, it } from "vitest";
import { dayLabel, describeSydneyNow, fromSydney, toSydney } from "./sydney-time";

describe("toSydney", () => {
  it("uses daylight saving time in summer", () => {
    expect(toSydney(new Date("2026-12-31T20:30:00Z"))).toEqual({ date: "2027-01-01", time: "07:30" });
  });

  it("uses standard time in winter", () => {
    expect(toSydney(new Date("2026-06-30T20:30:00Z"))).toEqual({ date: "2026-07-01", time: "06:30" });
  });
});

describe("fromSydney", () => {
  it("is the reverse of toSydney", () => {
    for (const iso of ["2026-01-15T03:00:00Z", "2026-07-15T21:45:00Z", "2026-10-12T13:59:00Z"]) {
      expect(fromSydney(toSydney(new Date(iso))).toISOString()).toBe(new Date(iso).toISOString());
    }
  });

  it("handles times just after daylight saving starts", () => {
    // Clocks went forward at 02:00 on 4 October 2026.
    expect(fromSydney({ date: "2026-10-04", time: "06:30" }).toISOString()).toBe("2026-10-03T19:30:00.000Z");
    expect(fromSydney({ date: "2026-10-04", time: "01:30" }).toISOString()).toBe("2026-10-03T15:30:00.000Z");
  });

  it("handles times just after daylight saving ends", () => {
    // Clocks went back at 03:00 on 5 April 2026.
    expect(fromSydney({ date: "2026-04-05", time: "21:00" }).toISOString()).toBe("2026-04-05T11:00:00.000Z");
  });
});

describe("labels", () => {
  it("names the day", () => {
    expect(dayLabel(new Date("2026-10-12T20:00:00Z"))).toBe("Tue, 13 Oct");
  });

  it("describes now for the model", () => {
    expect(describeSydneyNow(new Date("2026-10-12T03:05:00Z"))).toBe("Monday 12 October 2026, 14:05");
  });
});
