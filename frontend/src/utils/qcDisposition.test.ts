import { describe, expect, it } from "vitest";

import { COMPLEX_REPEAT_WINDOW_DAYS, complexDaysLeft } from "./qcDisposition";

const DAY = 86_400_000;
const QC_AT = "2026-10-01T10:00:00Z";
const qcMs = Date.parse(QC_AT);

describe("complexDaysLeft", () => {
  it("counts down the 30-day window from the QC date", () => {
    expect(complexDaysLeft("repeatable_complex", QC_AT, qcMs)).toBe(COMPLEX_REPEAT_WINDOW_DAYS);
    expect(complexDaysLeft("repeatable_complex", QC_AT, qcMs + 10.5 * DAY)).toBe(20);
    expect(complexDaysLeft("repeatable_complex", QC_AT, qcMs + 33 * DAY)).toBe(-3);
  });

  it("is null for other dispositions or a missing QC timestamp", () => {
    expect(complexDaysLeft("repeatable", QC_AT, qcMs)).toBeNull();
    expect(complexDaysLeft("recoverable", QC_AT, qcMs)).toBeNull();
    expect(complexDaysLeft("repeatable_complex", null, qcMs)).toBeNull();
    expect(complexDaysLeft(null, QC_AT, qcMs)).toBeNull();
  });
});
