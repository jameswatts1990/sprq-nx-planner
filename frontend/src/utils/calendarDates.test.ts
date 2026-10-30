import { describe, expect, it } from "vitest";

import { formatDateTime } from "./calendarDates";

describe("formatDateTime", () => {
  it("renders UK day-month order with a 24h time and no seconds, in local time", () => {
    const iso = new Date(2026, 9, 28, 9, 14, 7).toISOString();
    expect(formatDateTime(iso)).toBe("28 Oct 2026, 09:14");
  });

  it("zero-pads the hour and minute", () => {
    const iso = new Date(2026, 0, 3, 7, 5).toISOString();
    expect(formatDateTime(iso)).toBe("3 Jan 2026, 07:05");
  });
});
