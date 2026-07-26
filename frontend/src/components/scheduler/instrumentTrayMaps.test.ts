import { describe, expect, it } from "vitest";

import type { CellOut } from "@/types/cell";
import type { PlateOut, RunOut } from "@/types/schedule";

import { computeInstrumentTrayMaps } from "./instrumentTrayMaps";
import { computeTrayEvictionDates, computeTrayFoundingDates, computeVacatedTrayIds } from "./waitingCells";

const WEEK = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"];
const SERIAL = "84047";

function cell(overrides: Partial<CellOut> = {}): CellOut {
  return {
    id: 1,
    code: "CELL-A000001",
    max_uses: 3,
    status: "open",
    uses_consumed: 0,
    uses_remaining: 3,
    burned_barcodes: [],
    window_hours_elapsed: null,
    window_breached: false,
    current_instrument_serial: SERIAL,
    current_well: "A01",
    last_use_run_date: null,
    first_use_started_at: null,
    first_use_planned_start_at: null,
    created_at: "2026-07-20T12:00:00Z",
    stopped_reason: null,
    stopped_at: null,
    discarded_reason: null,
    discarded_at: null,
    has_failed_use: false,
    needs_qc_report: false,
    awaiting_credit: false,
    pacbio_case_number: null,
    pacbio_reported_at: null,
    pacbio_credit_confirmed_at: null,
    credit_received_at: null,
    tray_id: 1,
    tray_position: 1,
    tray_size: 4,
    ...overrides,
  };
}

/** A tray of 4 cells sharing one carousel position (well letters A-D of `col`, e.g. "01"). */
function trayCells(trayId: number, col: "01" | "02", overridesByPos: Partial<CellOut>[] = []): CellOut[] {
  const letters = ["A", "B", "C", "D"];
  return letters.map((letter, i) =>
    cell({
      id: trayId * 10 + i,
      code: `CELL-${letter}00${trayId}0${i}`,
      tray_id: trayId,
      tray_position: i + 1,
      current_well: `${letter}${col}`,
      ...overridesByPos[i],
    }),
  );
}

function run(loadDate: string, acquireDates: string[] = [loadDate]): RunOut {
  const plates: PlateOut[] = acquireDates.map((acquire_date, i) => ({
    plate_id: i + 1,
    plate_index: (i + 1) as 1 | 2,
    acquire_date,
    is_reuse: i > 0,
    movie_hours: 24,
    status: "planned",
    planned_start_at: `${loadDate}T12:00:00Z`,
    planned_end_at: `${loadDate}T18:00:00Z`,
    actual_start_at: null,
    actual_end_at: null,
    stages: [],
  }));
  return {
    run_id: 1,
    instrument_serial: SERIAL,
    load_date: loadDate,
    run_name: null,
    status: "planned",
    lock_until: `${loadDate}T18:00:00Z`,
    is_locked: false,
    plates,
  };
}

function grouped(runs: RunOut[]): Map<string, Map<string, RunOut>> {
  const byDate = new Map<string, RunOut>();
  for (const r of runs) byDate.set(r.load_date, r);
  return new Map([[SERIAL, byDate]]);
}

/** Rebuilds the tray-derivation maps the same way SchedulePage does, so tests exercise the
 * real residency inputs rather than hand-rolled maps. */
function derive(cells: CellOut[]) {
  const founding = computeTrayFoundingDates(cells);
  const eviction = computeTrayEvictionDates(cells, founding);
  const vacated = computeVacatedTrayIds(cells);
  return { founding, eviction, vacated };
}

describe("computeInstrumentTrayMaps", () => {
  it("projects a single used tray in the Plate 1 position with uses remaining and expiry", () => {
    const cells = trayCells(1, "01", [
      { uses_consumed: 2, uses_remaining: 1, last_use_run_date: "2026-07-21", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
    ]);
    const { founding, eviction, vacated } = derive(cells);
    const maps = computeInstrumentTrayMaps(cells, grouped([run("2026-07-20"), run("2026-07-21")]), WEEK, founding, eviction, vacated);

    const map = maps.get(SERIAL)!;
    expect(map.asOfDate).toBe("2026-07-21");
    expect(map.carousel[1]).toBeNull(); // nothing in Plate 2 position
    const tray = map.carousel[0]!;
    expect(tray.trayId).toBe(1);
    expect(tray.positions.map((p) => p.letter)).toEqual(["A", "B", "C", "D"]);
    expect(tray.positions[0]).toMatchObject({ usesRemaining: 1, status: "open" });
    expect(tray.positions[1]).toMatchObject({ usesRemaining: 2 });
    // A + 108h from 2026-07-20T12:00Z = 2026-07-25T00:00Z
    expect(tray.positions[0].expiryAt).toBe("2026-07-25T00:00:00.000Z");
    expect(tray.positions[0].expiryEstimated).toBe(false);
    // Never-used C/D siblings have no anchor -> no expiry.
    expect(tray.positions[2].expiryAt).toBeNull();
  });

  it("places a *02 tray in the Plate 2 carousel position", () => {
    const cells = trayCells(2, "02", [{ uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" }]);
    const { founding, eviction, vacated } = derive(cells);
    const maps = computeInstrumentTrayMaps(cells, grouped([run("2026-07-20")]), WEEK, founding, eviction, vacated);

    const map = maps.get(SERIAL)!;
    expect(map.carousel[0]).toBeNull();
    expect(map.carousel[1]!.trayId).toBe(2);
  });

  it("marks a planned-but-unconfirmed first use's expiry as estimated", () => {
    const cells = trayCells(1, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: null, first_use_planned_start_at: "2026-07-20T12:00:00Z" },
    ]);
    const { founding, eviction, vacated } = derive(cells);
    const maps = computeInstrumentTrayMaps(cells, grouped([run("2026-07-20")]), WEEK, founding, eviction, vacated);

    const p = maps.get(SERIAL)!.carousel[0]!.positions[0];
    expect(p.expiryAt).toBe("2026-07-25T00:00:00.000Z");
    expect(p.expiryEstimated).toBe(true);
  });

  it("flags an about-to-expire open cell as 'soon' and a terminal cell as 'expired'", () => {
    const cells = trayCells(1, "01", [
      // 96h into its 108h window -> 12h left -> soon
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z", window_hours_elapsed: 96 },
      // exhausted -> expired
      { uses_consumed: 3, uses_remaining: 0, status: "exhausted", last_use_run_date: "2026-07-22", first_use_started_at: "2026-07-20T12:00:00Z" },
      // plenty of window left -> none
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z", window_hours_elapsed: 10 },
    ]);
    const { founding, eviction, vacated } = derive(cells);
    const tray = computeInstrumentTrayMaps(cells, grouped([run("2026-07-20")]), WEEK, founding, eviction, vacated).get(SERIAL)!.carousel[0]!;
    expect(tray.positions[0].urgency).toBe("soon");
    expect(tray.positions[1].urgency).toBe("expired");
    expect(tray.positions[2].urgency).toBe("none");
  });

  it("shows 0 usable uses for a terminal cell even if it physically has capacity left (disposed early)", () => {
    const cells = trayCells(1, "01", [
      // Disposed at a 2x dial: exhausted, but physically 1 use unspent - not runnable, so 0.
      { status: "exhausted", uses_consumed: 2, uses_remaining: 1, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
    ]);
    const { founding, eviction, vacated } = derive(cells);
    const tray = computeInstrumentTrayMaps(cells, grouped([run("2026-07-20")]), WEEK, founding, eviction, vacated).get(SERIAL)!.carousel[0]!;
    expect(tray.positions[0]).toMatchObject({ status: "exhausted", usesRemaining: 0, urgency: "expired" });
  });

  it("shows the successor tray, not the evicted one, once a later tray is founded in the same position", () => {
    // Tray 1 used Mon; tray 2 (same A01-D01 position) founded Wed -> tray 1 evicted Wed.
    const oldTray = trayCells(1, "01", [
      { uses_consumed: 3, uses_remaining: 0, status: "exhausted", last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 3, uses_remaining: 0, status: "exhausted", last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 3, uses_remaining: 0, status: "exhausted", last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 3, uses_remaining: 0, status: "exhausted", last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
    ]);
    const newTray = trayCells(2, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-23", first_use_started_at: "2026-07-23T12:00:00Z" },
    ]);
    const cells = [...oldTray, ...newTray];
    const { founding, eviction, vacated } = derive(cells);
    const maps = computeInstrumentTrayMaps(cells, grouped([run("2026-07-20"), run("2026-07-23")]), WEEK, founding, eviction, vacated);

    // as of Fri (latest scheduled) the successor tray 2 is resident.
    expect(maps.get(SERIAL)!.carousel[0]!.trayId).toBe(2);
  });

  it("treats a fully-vacated tray with no successor as an empty carousel position", () => {
    const cells = trayCells(1, "01", [
      { uses_consumed: 3, uses_remaining: 0, status: "exhausted", last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 3, uses_remaining: 0, status: "exhausted", last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 0, uses_remaining: 0, status: "retired", last_use_run_date: null },
      { uses_consumed: 0, uses_remaining: 0, status: "retired", last_use_run_date: null },
    ]);
    const { founding, eviction, vacated } = derive(cells);
    const maps = computeInstrumentTrayMaps(cells, grouped([run("2026-07-20")]), WEEK, founding, eviction, vacated);
    expect(maps.get(SERIAL)!.carousel[0]).toBeNull();
  });

  it("reports asOfDate null and still shows a resident, never-evicted tray when nothing is scheduled this week", () => {
    const cells = trayCells(1, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2020-01-06", first_use_started_at: "2020-01-06T12:00:00Z" },
    ]);
    const { founding, eviction, vacated } = derive(cells);
    // No runs within WEEK -> asOfDate null; the tray (evicted === undefined) is still resident "now".
    const maps = computeInstrumentTrayMaps(cells, grouped([]), WEEK, founding, eviction, vacated);
    const map = maps.get(SERIAL)!;
    expect(map.asOfDate).toBeNull();
    expect(map.carousel[0]!.trayId).toBe(1);
  });

  it("ignores cells with no tray or on another instrument", () => {
    const cells = [
      cell({ id: 99, tray_id: null, tray_position: null }),
      cell({ id: 98, current_instrument_serial: "84098", tray_id: 5, current_well: "A01" }),
    ];
    const { founding, eviction, vacated } = derive(cells);
    const maps = computeInstrumentTrayMaps(cells, grouped([]), WEEK, founding, eviction, vacated);
    expect(maps.get(SERIAL)).toBeUndefined(); // no tray-linked cells on 84047
    expect(maps.get("84098")!.carousel[0]!.trayId).toBe(5);
  });
});
