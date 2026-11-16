import { describe, expect, it } from "vitest";

import type { ScheduleTrayCellOut } from "@/types/cell";

// Shared with the backend's tests/unit/test_schedule_trays.py: the same hand-written expectations
// pin this file's tray maps and their Python twins (services/schedule_trays.py), which choose the
// trays GET /api/cells/schedule-trays sends. It lives in frontend/ because the frontend image builds
// (tsc -b) with only frontend/ as its context; backend tests run from a full checkout.
import golden from "./__fixtures__/schedule_trays_golden.json";

import { computeInstrumentTrayMaps } from "./instrumentTrayMaps";
import { computeTrayEvictionDates, computeTrayFoundingDates } from "./waitingCells";

const cells = golden.cells as ScheduleTrayCellOut[];
const kept = new Set(golden.expected_kept_tray_ids);
const keptCells = cells.filter((c) => c.tray_id !== null && kept.has(c.tray_id));

function weekFrom(monday: string): string[] {
  const start = Date.parse(`${monday}T00:00:00Z`);
  return [0, 1, 2, 3, 4].map((d) => new Date(start + d * 86_400_000).toISOString().slice(0, 10));
}

function trayMaps(set: ScheduleTrayCellOut[], days: string[]) {
  const founding = computeTrayFoundingDates(set);
  return computeInstrumentTrayMaps(set, days, founding, computeTrayEvictionDates(set, founding));
}

describe("tray founding/eviction maps (golden fixture shared with the backend)", () => {
  it("founding dates match", () => {
    expect(Object.fromEntries(computeTrayFoundingDates(cells))).toEqual(golden.expected_founding);
  });

  it("eviction dates match", () => {
    const founding = computeTrayFoundingDates(cells);
    expect(Object.fromEntries(computeTrayEvictionDates(cells, founding))).toEqual(golden.expected_eviction);
  });
});

describe("schedule-trays scoping keeps the tray panel identical", () => {
  // Every week from the fixture's date_from on - the window's first day is date_from, or later.
  const weeksFromDateFrom = ["2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30", "2026-04-06", "2026-06-01"];

  it.each(weeksFromDateFrom)("week of %s: full set and the sent trays give the same tray maps", (monday) => {
    const days = weekFrom(monday);
    expect(trayMaps(keptCells, days)).toEqual(trayMaps(cells, days));
  });

  it("is a real filter: a week before date_from would differ (tray 1 was still resident)", () => {
    const days = weekFrom("2026-02-23");
    const full = trayMaps(cells, days).get("84047")?.carousel[0]?.trayId;
    expect(full).toBe(1);
    expect(trayMaps(keptCells, days).get("84047")?.carousel[0]?.trayId).not.toBe(1);
  });
});
