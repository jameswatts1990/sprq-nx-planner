import { describe, expect, it } from "vitest";

import type { CellTrayRowOut } from "@/types/cell";
import type { DowntimeOut } from "@/types/instrument";
import type { PlateOut, RunOut } from "@/types/schedule";

import {
  downtimeLine,
  expiringTrays,
  formatTodayHeading,
  instrumentLabel,
  loadedAt,
  oldestReviewDays,
  runsLoadingToday,
  wellCount,
} from "./todayView";

function plate(stages: number, actual_start_at: string | null = null): PlateOut {
  return {
    plate_id: 1,
    plate_index: 1,
    acquire_date: "2026-11-16",
    is_reuse: false,
    movie_hours: 24,
    status: "planned",
    planned_start_at: "2026-11-16T09:00:00Z",
    planned_end_at: "2026-11-17T09:00:00Z",
    actual_start_at,
    actual_end_at: null,
    stages: Array.from({ length: stages }, () => ({}) as PlateOut["stages"][number]),
  };
}

function run(run_id: number, serial: string, plates: PlateOut[], status: RunOut["status"] = "planned"): RunOut {
  return {
    run_id,
    instrument_serial: serial,
    load_date: "2026-11-16",
    run_name: null,
    status,
    cell_type: "sprq_nx",
    lock_until: "2026-11-16T12:00:00Z",
    is_locked: false,
    effective_start_at: null,
    starts_later_than_requested: false,
    plates,
  };
}

const period = (start_date: string, end_date: string | null, note: string | null = null): DowntimeOut => ({
  id: 1,
  start_date,
  end_date,
  kind: "planned",
  note,
  created_by: null,
  created_at: "2026-11-01T09:00:00Z",
});

describe("formatTodayHeading", () => {
  it("reads as the weekday and date", () => {
    expect(formatTodayHeading("2026-11-16")).toBe("Monday 16 November");
  });
});

describe("runsLoadingToday", () => {
  it("drops emptied runs and orders by instrument", () => {
    const runs = [run(3, "84098", [plate(2)]), run(1, "84047", [plate(0)]), run(2, "84047", [plate(1), plate(4)])];
    expect(runsLoadingToday(runs).map((r) => r.run_id)).toEqual([2, 3]);
    expect(wellCount(runs[2])).toBe(5);
  });
});

describe("loadedAt", () => {
  it("is the first plate's real start once confirmed, null while planned", () => {
    expect(loadedAt(run(1, "84047", [plate(1, "2026-11-16T09:10:00Z")]))).toBeNull();
    const loaded = run(1, "84047", [plate(1, "2026-11-16T09:10:00Z"), plate(1, "2026-11-16T09:05:00Z")], "running");
    expect(loadedAt(loaded)).toBe("2026-11-16T09:05:00Z");
  });
});

describe("expiringTrays", () => {
  it("keeps only trays whose window closes within the warning", () => {
    const tray = (tray_id: number, expires_in_hours: number | null) => ({ tray_id, expires_in_hours }) as CellTrayRowOut;
    const rows = [tray(1, 2), tray(2, 18), tray(3, 18.5), tray(4, null)];
    expect(expiringTrays(rows, 18).map((r) => r.tray_id)).toEqual([1, 2]);
  });
});

describe("instrumentLabel", () => {
  it("uses the instrument's name, else Revio and its serial", () => {
    const instruments = [
      { serial_number: "84047", name: "Revio 1" },
      { serial_number: "84098", name: null },
    ];
    expect(instrumentLabel("84047", instruments)).toBe("Revio 1");
    expect(instrumentLabel("84098", instruments)).toBe("Revio 84098");
  });
});

describe("downtimeLine", () => {
  it("says down now, else the next downtime, else nothing", () => {
    const now = period("2026-11-15", "2026-11-17", "Laser swap.");
    expect(downtimeLine({ down_now: true, downtimes: [now], next_downtime: null }, "2026-11-16")).toEqual({
      tone: "warn",
      text: "Down now: Planned · 15–17 Nov — Laser swap",
    });
    const ahead = period("2026-11-20", null);
    expect(downtimeLine({ down_now: false, downtimes: [ahead], next_downtime: ahead }, "2026-11-16")).toEqual({
      tone: "info",
      text: "Downtime ahead: Planned · from 20 Nov",
    });
    expect(downtimeLine({ down_now: false, downtimes: [], next_downtime: null }, "2026-11-16")).toBeNull();
  });
});

describe("oldestReviewDays", () => {
  const now = Date.parse("2026-11-26T12:00:00");
  it("counts whole days since the oldest LangQC sign-off still waiting", () => {
    const pending = [{ qc_date: "2026-11-24T09:00:00" }, { qc_date: "2026-11-14T15:00:00" }, { qc_date: null }];
    expect(oldestReviewDays(pending, now)).toBe(11);
  });
  it("is null when nothing is waiting or nothing has a sign-off date", () => {
    expect(oldestReviewDays([], now)).toBeNull();
    expect(oldestReviewDays([{ qc_date: null }], now)).toBeNull();
  });
});
