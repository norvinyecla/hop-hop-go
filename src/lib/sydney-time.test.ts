import { describe, expect, it } from "vitest";
import { addDays, dayLabel, fromSydney, startOfSydneyDay, sydneyDate, sydneyNow, toSydney } from "./sydney-time";

describe("toSydney", () => {
  it("uses daylight saving time in summer", () => {
    expect(toSydney(new Date("2026-12-31T20:30:00Z"))).toEqual({ date: "2027-01-01", time: "07:30" });
  });

  it("uses standard time in winter", () => {
    expect(toSydney(new Date("2026-06-30T20:30:00Z"))).toEqual({ date: "2026-07-01", time: "06:30" });
  });
});

describe("sydneyDate", () => {
  it("uses the Sydney date, not the UTC one", () => {
    // 20:00 UTC on the 11th is 07:00 on the 12th in Sydney (daylight saving, +11).
    expect(sydneyDate(new Date("2026-10-11T20:00:00Z"))).toBe("2026-10-12");
    expect(sydneyDate(new Date("2026-10-12T05:00:00Z"))).toBe("2026-10-12");
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

describe("startOfSydneyDay", () => {
  it("handles standard and daylight saving time", () => {
    expect(startOfSydneyDay("2026-07-01").toISOString()).toBe("2026-06-30T14:00:00.000Z");
    expect(startOfSydneyDay("2026-10-17").toISOString()).toBe("2026-10-16T13:00:00.000Z");
  });

  it("handles the days daylight saving starts and ends", () => {
    // Starts 2am Sunday 4 October 2026; ends 3am Sunday 5 April 2026.
    expect(startOfSydneyDay("2026-10-04").toISOString()).toBe("2026-10-03T14:00:00.000Z");
    expect(startOfSydneyDay("2026-04-05").toISOString()).toBe("2026-04-04T13:00:00.000Z");
  });
});

describe("addDays", () => {
  it("crosses month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("labels", () => {
  it("names the day", () => {
    expect(dayLabel(new Date("2026-10-12T20:00:00Z"))).toBe("Tue, 13 Oct");
  });

  it("names the day and time for the model", () => {
    expect(sydneyNow(new Date("2026-10-12T05:58:00Z"))).toBe("Monday 12 October 2026 at 16:58");
  });
});
