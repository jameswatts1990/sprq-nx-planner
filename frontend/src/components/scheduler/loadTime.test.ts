import { describe, expect, it } from "vitest";

import { formatLoadTime, isValidLoadTime, parseLoadTime } from "./loadTime";

describe("Confirm-Revio-loaded time field", () => {
  it("formats a run's planned start as hh:mm on the local (lab) wall clock", () => {
    // Derive the expectation from local getters so this holds regardless of the runner's TZ:
    // the field prefills with what the operator would read off the instrument's own clock.
    for (const iso of ["2026-07-27T09:05:00Z", "2026-01-15T00:00:00Z", "2026-07-27T23:59:00Z"]) {
      const d = new Date(iso);
      const expected = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      expect(formatLoadTime(d)).toBe(expected);
    }
  });

  it("accepts valid 24-hour times as h:mm or hh:mm", () => {
    expect(parseLoadTime("09:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseLoadTime("9:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseLoadTime("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseLoadTime("00:00")).toEqual({ hour: 0, minute: 0 });
    expect(parseLoadTime("  14:30  ")).toEqual({ hour: 14, minute: 30 });
    expect(isValidLoadTime("14:30")).toBe(true);
  });

  it("rejects out-of-range or malformed times", () => {
    for (const bad of ["25:99", "24:00", "12:60", "9:5", "1200", "12:5", "", "ab:cd", "12:", ":30"]) {
      expect(parseLoadTime(bad)).toBeNull();
      expect(isValidLoadTime(bad)).toBe(false);
    }
  });
});
