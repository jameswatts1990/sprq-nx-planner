import { describe, expect, it } from "vitest";

import type { StatsResponse } from "@/types/stats";

import {
  DEFAULT_STATS_VIEW,
  formatPeriod,
  rangeLabel,
  readStatsView,
  resolveRange,
  statsCsv,
  statsCsvFilename,
  writeStatsView,
  type StatsView,
} from "./statsView";

const TODAY = new Date(2026, 10, 6); // Fri 6 Nov 2026, local
const view = (patch: Partial<StatsView>): StatsView => ({ ...DEFAULT_STATS_VIEW, ...patch });

describe("resolveRange", () => {
  it.each([
    ["30d", "2026-10-07", "2026-11-06"],
    ["90d", "2026-08-08", "2026-11-06"],
    ["this-month", "2026-11-01", "2026-11-30"],
    ["last-month", "2026-10-01", "2026-10-31"],
    ["this-quarter", "2026-10-01", "2026-12-31"],
    ["last-quarter", "2026-07-01", "2026-09-30"],
    ["this-year", "2026-01-01", "2026-12-31"],
  ] as const)("%s", (range, from, to) => {
    expect(resolveRange(view({ range }), TODAY)).toEqual({ from, to });
  });

  it("last quarter from January reaches back into the previous year", () => {
    expect(resolveRange(view({ range: "last-quarter" }), new Date(2027, 0, 15))).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });

  it("all time is open-ended; custom sends what was typed", () => {
    expect(resolveRange(view({ range: "all" }), TODAY)).toEqual({});
    expect(resolveRange(view({ range: "custom", from: "2026-09-01", to: "" }), TODAY)).toEqual({ from: "2026-09-01", to: undefined });
  });
});

describe("URL state", () => {
  it("round-trips, leaving defaults out", () => {
    const params = writeStatsView(new URLSearchParams("tab=x"), { range: "custom", from: "2026-09-01", to: "2026-09-30", group: "month" });
    expect(params.toString()).toBe("tab=x&range=custom&from=2026-09-01&to=2026-09-30&group=month");
    expect(readStatsView(params)).toEqual(view({ range: "custom", from: "2026-09-01", to: "2026-09-30", group: "month" }));
    expect(writeStatsView(params, { range: "90d", from: "", to: "", group: "week" }).toString()).toBe("tab=x");
  });

  it("ignores junk", () => {
    expect(readStatsView(new URLSearchParams("range=decade&group=fortnight&from=yesterday"))).toEqual(DEFAULT_STATS_VIEW);
  });
});

describe("labels", () => {
  it("formats each grouping's period", () => {
    expect(formatPeriod("2026-07-06", "week")).toBe("6 Jul");
    expect(formatPeriod("2026-07-06", "week", true)).toBe("w/c 6 Jul 2026");
    expect(formatPeriod("2026-07-01", "month")).toBe("Jul 2026");
    expect(formatPeriod("2026-07-01", "month", true)).toBe("July 2026");
    expect(formatPeriod("2026-10-01", "quarter")).toBe("Q4 2026");
  });

  it("describes the range", () => {
    expect(rangeLabel({ from: "2026-08-01", to: "2026-10-31" })).toBe("1 Aug – 31 Oct 2026");
    expect(rangeLabel({})).toBe("All time");
    expect(rangeLabel({ from: "2026-08-01" })).toBe("From 1 Aug 2026");
  });

  it("names the CSV after the report", () => {
    expect(statsCsvFilename({ from: "2026-08-01", to: "2026-10-31" }, view({ group: "month", instrument: "84047" }))).toBe(
      "runnx-stats_2026-08-01_2026-10-31_by-month_84047.csv",
    );
  });
});

describe("statsCsv", () => {
  it("one row per period across every series, a Total row, then the availability block", () => {
    const data = {
      group_by: "month",
      headline: {
        runs_completed: 3,
        samples_sequenced: 10,
        planned_runs: 2,
        avg_uses_per_cell: 2.5,
        pct_reaching_use3: 50,
        failure_rate: 8.3,
        plate_fill_pct: 75,
        cells_awaiting_credit: 0,
        credits_received: 0,
      },
      throughput: {
        series: [
          { period: "2026-09-01", runs_completed: 1, samples_sequenced: 4, planned_runs: 0 },
          { period: "2026-10-01", runs_completed: 2, samples_sequenced: 6, planned_runs: 2 },
        ],
        per_instrument: [],
        movie_hours_mix: [],
      },
      reuse: {
        depth_distribution: [],
        avg_uses_trend: [{ period: "2026-10-01", avg_uses: 2.5 }],
        plate_fill: [
          { period: "2026-09-01", filled: 4, capacity: 4 },
          { period: "2026-10-01", filled: 8, capacity: 12 },
        ],
        window_waste: { full_3_uses: 0, expired_early: 0 },
      },
      failures: {
        outcomes: [],
        failure_rate_trend: [
          { period: "2026-09-01", failed: 0, total: 4 },
          { period: "2026-10-01", failed: 1, total: 8 },
        ],
        credit_funnel: { needs_report: 0, reported: 0, awaiting: 0, received: 0 },
      },
      inventory: { cell_status: [], sample_funnel: [], import_volume: [{ period: "2026-08-01", imported: 7 }] },
      availability: [
        { serial: "84047", name: "Revio A", weekdays: 20, planned_down: 2, unplanned_down: 1, uptime_pct: 85 },
        { serial: "84098", name: null, weekdays: 0, planned_down: 0, unplanned_down: 0, uptime_pct: 0 },
      ],
    } satisfies StatsResponse;

    const lines = statsCsv(data).split("\r\n");
    expect(lines[0]).toBe(
      "Period,Starts,Runs completed,Samples sequenced,Planned runs,Wells used,Plate capacity (wells),Plate fill %,Wells loaded,Failed,Failure rate %,Avg uses per cell,Samples imported",
    );
    expect(lines.slice(1)).toEqual([
      "August 2026,2026-08-01,0,0,0,0,0,,0,0,,,7",
      "September 2026,2026-09-01,1,4,0,4,4,100,4,0,0,,0",
      "October 2026,2026-10-01,2,6,2,8,12,66.7,8,1,12.5,2.5,0",
      "Total,,3,10,2,12,16,75,12,1,8.3,2.5,7",
      "",
      "Instrument,Weekdays,Planned down,Unplanned down,Uptime %",
      "Revio A (84047),20,2,1,85",
      "84098,0,0,0,",
    ]);
  });
});
