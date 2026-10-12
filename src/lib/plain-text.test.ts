import { describe, expect, it } from "vitest";
import { plainText } from "./plain-text";

describe("plainText", () => {
  it("removes bold and italics", () => {
    expect(plainText("Take the **T1** at *8:28pm*, it's __direct__ and _quick_.")).toBe(
      "Take the T1 at 8:28pm, it's direct and quick.",
    );
  });

  it("turns list markers into bullets", () => {
    expect(plainText("Options:\n- T1 at 20:28\n* M1 at 20:40\n  + nested")).toBe(
      "Options:\n• T1 at 20:28\n• M1 at 20:40\n  • nested",
    );
  });

  it("removes headings, inline code and link targets", () => {
    expect(plainText("## Best trip\nLeave from `Platform 1`. See [TfNSW](https://transportnsw.info).")).toBe(
      "Best trip\nLeave from Platform 1. See TfNSW.",
    );
  });

  it("leaves ordinary text alone", () => {
    const text = "Leave at 8:28pm - it's 26 min. 2 * 3 = 6, see station_name.\n1. First\n2. Second";
    expect(plainText(text)).toBe(text);
  });

  it("copes with half-streamed formatting", () => {
    expect(plainText("Take the **T1")).toBe("Take the **T1");
  });
});
