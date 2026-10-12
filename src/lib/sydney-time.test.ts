import { describe, expect, it } from "vitest";
import { addDays, startOfSydneyDay, sydneyDate, sydneyNow } from "./sydney-time";

describe("sydneyDate", () => {
  it("uses the Sydney date, not the UTC one", () => {
    // 20:00 UTC on the 11th is 07:00 on the 12th in Sydney (daylight saving, +11).
    expect(sydneyDate(new Date("2026-10-11T20:00:00Z"))).toBe("2026-10-12");
    expect(sydneyDate(new Date("2026-10-12T05:00:00Z"))).toBe("2026-10-12");
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

describe("sydneyNow", () => {
  it("names the day for the model", () => {
    expect(sydneyNow(new Date("2026-10-12T05:58:00Z"))).toBe("Monday 12 October 2026 at 16:58");
  });
});
