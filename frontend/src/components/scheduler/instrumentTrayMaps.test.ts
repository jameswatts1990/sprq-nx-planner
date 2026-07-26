import { describe, expect, it } from "vitest";

import type { CellOut } from "@/types/cell";

import { breakoutOffsetH, cellExpiryState, computeInstrumentTrayMaps, type TrayPositionView } from "./instrumentTrayMaps";
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

/** Rebuilds the tray-derivation maps the same way SchedulePage does, so tests exercise the
 * real residency inputs rather than hand-rolled maps. */
function derive(cells: CellOut[]) {
  const founding = computeTrayFoundingDates(cells);
  const eviction = computeTrayEvictionDates(cells, founding);
  const vacated = computeVacatedTrayIds(cells);
  return { founding, eviction, vacated };
}

function build(cells: CellOut[]) {
  const { founding, eviction, vacated } = derive(cells);
  return computeInstrumentTrayMaps(cells, WEEK, founding, eviction, vacated);
}

describe("computeInstrumentTrayMaps", () => {
  it("shows a single used tray in the Plate 1 position with uses remaining and expiry", () => {
    const cells = trayCells(1, "01", [
      { uses_consumed: 2, uses_remaining: 1, last_use_run_date: "2026-07-21", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
    ]);
    const map = build(cells).get(SERIAL)!;

    // Anchored to the week's first day, never a later scheduled day.
    expect(map.asOfDate).toBe("2026-07-20");
    expect(map.weekEndDate).toBe("2026-07-24");
    expect(map.futureTrays).toEqual([]);
    expect(map.carousel[1]).toBeNull(); // nothing in Plate 2 position
    const tray = map.carousel[0]!;
    expect(tray.trayId).toBe(1);
    expect(tray.positions.map((p) => p.cellNumber)).toEqual([1, 2, 3, 4]);
    expect(tray.positions[0]).toMatchObject({ usesRemaining: 1, status: "open" });
    expect(tray.positions[1]).toMatchObject({ usesRemaining: 2 });
    // Cell 1 (position 0) breaks out at the load anchor: 2026-07-20T12:00Z + 108h = 2026-07-25T00:00Z.
    expect(tray.positions[0].expiryAt).toBe("2026-07-25T00:00:00.000Z");
    expect(tray.positions[0].provisional).toBe(false);
    // Cell 2 breaks out 2h later (the intra-tray stagger), so it expires 2h later too.
    expect(tray.positions[1].expiryAt).toBe("2026-07-25T02:00:00.000Z");
    // Never-used C/D siblings have no anchor -> no expiry.
    expect(tray.positions[2].expiryAt).toBeNull();
  });

  it("places a *02 tray in the Plate 2 carousel position", () => {
    const cells = trayCells(2, "02", [{ uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" }]);
    const map = build(cells).get(SERIAL)!;
    expect(map.carousel[0]).toBeNull();
    expect(map.carousel[1]!.trayId).toBe(2);
  });

  it("staggers each cell's expiry: 2h apart within a tray, +24h for the Plate 2 tray", () => {
    const shared = { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" };
    const p1 = trayCells(1, "01", [shared, shared, shared, shared]);
    const p2 = trayCells(2, "02", [shared, shared, shared, shared]);
    const map = build([...p1, ...p2]).get(SERIAL)!;
    // Plate 1 tray: cells 1-4 break out at T+0/+2/+4/+6, so expiry = load + offset + 108h.
    expect(map.carousel[0]!.positions.map((p) => p.expiryAt)).toEqual([
      "2026-07-25T00:00:00.000Z",
      "2026-07-25T02:00:00.000Z",
      "2026-07-25T04:00:00.000Z",
      "2026-07-25T06:00:00.000Z",
    ]);
    // Plate 2 tray shares the same load anchor but its cells break out ~24h later.
    expect(map.carousel[1]!.positions[0].expiryAt).toBe("2026-07-26T00:00:00.000Z");
    expect(map.carousel[1]!.positions[3].expiryAt).toBe("2026-07-26T06:00:00.000Z");
  });

  it("marks a planned-but-unconfirmed first use's expiry as provisional", () => {
    const cells = trayCells(1, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: null, first_use_planned_start_at: "2026-07-20T12:00:00Z" },
    ]);
    const p = build(cells).get(SERIAL)!.carousel[0]!.positions[0];
    expect(p.expiryAt).toBe("2026-07-25T00:00:00.000Z");
    expect(p.provisional).toBe(true);
  });

  it("shows 0 usable uses for a terminal cell even if it physically has capacity left (disposed early)", () => {
    const cells = trayCells(1, "01", [
      // Disposed at a 2x dial: exhausted, but physically 1 use unspent - not runnable, so 0.
      { status: "exhausted", uses_consumed: 2, uses_remaining: 1, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
    ]);
    const tray = build(cells).get(SERIAL)!.carousel[0]!;
    expect(tray.positions[0]).toMatchObject({ status: "exhausted", usesRemaining: 0 });
  });

  it("keeps the current tray up top and lists a mid-week successor as a future tray (turnover)", () => {
    // Tray 1 (open, used, resident at the week's start) ages out mid-week; tray 2 is loaded
    // Wed into the same A01-D01 position -> tray 1 evicted Wed, so at Mon it's still current
    // and tray 2 shows in the "loaded later" group by id only.
    const oldTray = trayCells(1, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
    ]);
    const newTray = trayCells(2, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-23", first_use_started_at: "2026-07-23T12:00:00Z" },
    ]);
    const map = build([...oldTray, ...newTray]).get(SERIAL)!;

    expect(map.carousel[0]!.trayId).toBe(1); // the current tray, with full state
    expect(map.futureTrays).toEqual([{ trayId: 2, carousel: 0, foundingDate: "2026-07-23" }]);
  });

  it("promotes a mid-week tray into the slot when nothing usable is resident at the week's start", () => {
    // Every cell of tray 1 is exhausted -> vacated (physically gone), so nothing is shown in the
    // slot at the week's start; tray 2, founded Wed, is then this position's only usable tray, so
    // it fills the slot rather than being relegated to the "loaded later" turnover group.
    const oldTray = trayCells(1, "01", [0, 1, 2, 3].map(() => ({
      uses_consumed: 3,
      uses_remaining: 0,
      status: "exhausted" as const,
      last_use_run_date: "2026-07-20",
      first_use_started_at: "2026-07-20T12:00:00Z",
    })));
    const newTray = trayCells(2, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-23", first_use_started_at: "2026-07-23T12:00:00Z" },
    ]);
    const map = build([...oldTray, ...newTray]).get(SERIAL)!;

    expect(map.carousel[0]!.trayId).toBe(2);
    expect(map.futureTrays).toEqual([]);
  });

  it("shows a tray first loaded mid-week in its slot, not 'loaded later', when it's the position's only tray", () => {
    // A brand-new run scheduled on Wed with no earlier tray in that position: the tray belongs in
    // the carousel slot, not the "loaded later" group (which is only for a genuine turnover of a
    // tray already resident this week).
    const cells = trayCells(3, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2026-07-22", first_use_started_at: "2026-07-22T12:00:00Z" },
    ]);
    const map = build(cells).get(SERIAL)!;
    expect(map.carousel[0]!.trayId).toBe(3);
    expect(map.futureTrays).toEqual([]);
  });

  it("treats a fully-vacated tray with no successor as an empty carousel position", () => {
    const cells = trayCells(1, "01", [
      { uses_consumed: 3, uses_remaining: 0, status: "exhausted", last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 3, uses_remaining: 0, status: "exhausted", last_use_run_date: "2026-07-20", first_use_started_at: "2026-07-20T12:00:00Z" },
      { uses_consumed: 0, uses_remaining: 0, status: "retired", last_use_run_date: null },
      { uses_consumed: 0, uses_remaining: 0, status: "retired", last_use_run_date: null },
    ]);
    const map = build(cells).get(SERIAL)!;
    expect(map.carousel[0]).toBeNull();
    expect(map.futureTrays).toEqual([]);
  });

  it("still shows a resident, never-evicted tray whose last use predates the viewed week", () => {
    const cells = trayCells(1, "01", [
      { uses_consumed: 1, uses_remaining: 2, last_use_run_date: "2020-01-06", first_use_started_at: "2020-01-06T12:00:00Z" },
    ]);
    const map = build(cells).get(SERIAL)!;
    expect(map.asOfDate).toBe("2026-07-20");
    expect(map.carousel[0]!.trayId).toBe(1);
  });

  it("ignores cells with no tray or on another instrument", () => {
    const cells = [
      cell({ id: 99, tray_id: null, tray_position: null }),
      cell({ id: 98, current_instrument_serial: "84098", tray_id: 5, current_well: "A01" }),
    ];
    const maps = build(cells);
    expect(maps.get(SERIAL)).toBeUndefined(); // no tray-linked cells on 84047
    expect(maps.get("84098")!.carousel[0]!.trayId).toBe(5);
  });
});

/** A tray position with sensible defaults (open cell, breakout Mon noon, expiry Sat 00:00). */
function pos(overrides: Partial<TrayPositionView> = {}): TrayPositionView {
  return {
    cellId: 1,
    code: "CELL-A000001",
    cellNumber: 1,
    usesRemaining: 2,
    status: "open",
    breakoutAt: "2026-07-20T12:00:00.000Z",
    expiryAt: "2026-07-25T00:00:00.000Z", // breakout + 108h
    provisional: false,
    ...overrides,
  };
}

describe("cellExpiryState", () => {
  const REF = Date.parse("2026-07-24T12:00:00Z"); // Fri noon

  it("is 'ok' with comfortable window and 'soon' within a day of the deadline", () => {
    expect(cellExpiryState(pos({ expiryAt: "2026-07-28T00:00:00Z" }), REF)).toBe("ok");
    expect(cellExpiryState(pos({ expiryAt: "2026-07-25T00:00:00Z" }), REF)).toBe("soon"); // 12h left
  });

  it("is 'expired' once the reference instant passes the deadline", () => {
    expect(cellExpiryState(pos({ expiryAt: "2026-07-24T06:00:00Z" }), REF)).toBe("expired");
  });

  it("is 'scheduled' while the breakout is still in the future", () => {
    expect(
      cellExpiryState(pos({ breakoutAt: "2026-07-27T12:00:00Z", expiryAt: "2026-08-01T00:00:00Z" }), REF),
    ).toBe("scheduled");
  });

  it("is 'fresh' for an open cell with no clock, 'spent'/'expired' for terminal cells", () => {
    expect(cellExpiryState(pos({ breakoutAt: null, expiryAt: null }), REF)).toBe("fresh");
    expect(cellExpiryState(pos({ status: "exhausted" }), REF)).toBe("spent");
    expect(cellExpiryState(pos({ status: "retired" }), REF)).toBe("spent");
    expect(cellExpiryState(pos({ status: "window_expired" }), REF)).toBe("expired");
    expect(cellExpiryState(pos({ status: "stopped" }), REF)).toBe("expired");
  });
});

describe("breakoutOffsetH", () => {
  it("adds 2h per position within a tray and 24h for the Plate 2 carousel", () => {
    expect([1, 2, 3, 4].map((n) => breakoutOffsetH(0, n))).toEqual([0, 2, 4, 6]);
    expect([1, 2, 3, 4].map((n) => breakoutOffsetH(1, n))).toEqual([24, 26, 28, 30]);
  });
});
