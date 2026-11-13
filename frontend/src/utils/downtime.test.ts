import { describe, expect, it } from "vitest";

import type { DowntimeOut } from "@/types/instrument";
import { downtimeOn, downtimeReason, formatDowntime, formatDowntimeSpan, isDownOn } from "./downtime";
import { instrumentStatus } from "./instrumentStatus";

const period = (start_date: string, end_date: string | null, kind: DowntimeOut["kind"] = "planned"): DowntimeOut => ({
  id: 1,
  start_date,
  end_date,
  kind,
  note: null,
  created_by: null,
  created_at: "2026-11-01T09:00:00Z",
});

describe("downtimeOn / isDownOn", () => {
  const periods = [period("2026-11-10", "2026-11-12"), period("2026-11-20", null, "unplanned")];

  it("covers start to end inclusive, and open-ended periods forever", () => {
    expect(["2026-11-09", "2026-11-10", "2026-11-12", "2026-11-13"].map((d) => isDownOn(periods, d))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(downtimeOn(periods, "2027-03-01")).toBe(periods[1]);
    expect(isDownOn(undefined, "2026-11-10")).toBe(false);
  });
});

describe("formatDowntime", () => {
  it("shares the month, spans months, and says 'from' when open-ended", () => {
    expect(formatDowntimeSpan(period("2026-11-12", "2026-11-12"))).toBe("12 Nov");
    expect(formatDowntimeSpan(period("2026-11-12", "2026-11-14"))).toBe("12–14 Nov");
    expect(formatDowntimeSpan(period("2026-11-28", "2026-12-02"))).toBe("28 Nov – 2 Dec");
    expect(formatDowntime(period("2026-11-12", null, "unplanned"))).toBe("Unplanned · from 12 Nov");
  });

  it("trims a reason's full stop for splicing into a sentence", () => {
    expect(downtimeReason({ note: " Laser swap. " })).toBe("Laser swap");
    expect(downtimeReason({ note: "  " })).toBeNull();
  });
});

describe("instrumentStatus", () => {
  const base = {
    id: 1,
    serial_number: "84047",
    name: null,
    location: null,
    asset_number: null,
    active: true,
    downtimes: [],
    down_now: false,
    next_downtime: null,
    down_from: null,
    down_note: null,
    is_locked: false,
    locked_until: null,
  };

  it("reads Down only while a period covers today - a future one stays Ready", () => {
    const future = period("2099-01-05", "2099-01-06");
    expect(instrumentStatus({ ...base, downtimes: [future], next_downtime: future, down_from: future.start_date })).toBe(
      "ready",
    );
    expect(instrumentStatus({ ...base, down_now: true, is_locked: true })).toBe("down");
    expect(instrumentStatus({ ...base, down_now: true, active: false })).toBe("inactive");
  });
});
