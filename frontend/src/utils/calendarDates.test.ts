import { describe, expect, it } from "vitest";

import { formatDateRangeUTC, formatDateTime, parseDateOnly } from "./calendarDates";

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

describe("formatDateRangeUTC", () => {
  const range = (from: string, to: string) => formatDateRangeUTC(parseDateOnly(from), parseDateOnly(to));

  it("shares the month and year within one month", () => {
    expect(range("2026-11-02", "2026-11-06")).toBe("2 – 6 Nov 2026");
  });

  it("names both months when the range crosses a month", () => {
    expect(range("2026-11-30", "2026-12-04")).toBe("30 Nov – 4 Dec 2026");
  });

  it("names both years when the range crosses a year", () => {
    expect(range("2026-12-28", "2027-01-01")).toBe("28 Dec 2026 – 1 Jan 2027");
  });
});
