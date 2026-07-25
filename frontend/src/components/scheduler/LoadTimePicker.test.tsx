import { describe, expect, it } from "vitest";

import { clampLoadHour, fmtHour, LOAD_HOURS, stepLoadHour } from "./LoadTimePicker";

describe("LoadTimePicker model", () => {
  it("offers 13 hourly slots from 08:00 to 20:00", () => {
    expect(LOAD_HOURS).toHaveLength(13);
    expect(LOAD_HOURS[0]).toBe(8);
    expect(LOAD_HOURS[12]).toBe(20);
    expect(fmtHour(8)).toBe("08:00");
    expect(fmtHour(20)).toBe("20:00");
  });

  it("keeps an in-range starting value, falls back to noon otherwise", () => {
    expect(clampLoadHour(9)).toBe(9);
    expect(clampLoadHour(8)).toBe(8);
    expect(clampLoadHour(20)).toBe(20);
    expect(clampLoadHour(3)).toBe(12); // before 8am
    expect(clampLoadHour(23)).toBe(12); // after 8pm
  });

  it("steps forward/back and wraps at both ends", () => {
    expect(stepLoadHour(12, 1)).toBe(13);
    expect(stepLoadHour(12, -1)).toBe(11);
    expect(stepLoadHour(20, 1)).toBe(8); // wrap forward off the end
    expect(stepLoadHour(8, -1)).toBe(20); // wrap back off the start
  });
});
