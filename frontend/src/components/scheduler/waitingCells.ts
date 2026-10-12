import type { CellOut } from "@/types/cell";

/**
 * Earliest calendar day (YYYY-MM-DD) any cell in each physical tray was scheduled for its own
 * first use - the day that tray genuinely became "loaded" on an instrument, even though every
 * sibling's Cell row exists from the moment the tray is opened. `cells` should cover every status
 * a tray-linked cell can be in (open, terminal, stopped), so a founding cell that has since gone
 * terminal or been stopped still anchors the date. Prefers first_use_started_at (the confirmed
 * anchor) over first_use_planned_start_at - once a use is confirmed loaded its planned estimate
 * can go stale (e.g. the placement was later moved) while started_at reflects where it landed.
 */
export function computeTrayFoundingDates(cells: CellOut[]): Map<number, string> {
  const dates = new Map<number, string>();
  for (const cell of cells) {
    if (cell.tray_id === null) continue;
    const anchor = cell.first_use_started_at ?? cell.first_use_planned_start_at;
    if (!anchor) continue;
    const day = anchor.slice(0, 10);
    const existing = dates.get(cell.tray_id);
    if (!existing || day < existing) dates.set(cell.tray_id, day);
  }
  return dates;
}

/** Mirrors backend/app/engine/constants.py's WELLS - Plate 1 is indices 0-3 (A01-D01), Plate 2
 * is 4-7 (A02-D02). A cell's home well (CellOut.current_well) names its fixed TRAY bay + position
 * for life, so this also splits cells into the instrument's two carousel positions (see
 * trayPositionGroup). It is NOT a prediction of which plate slot a drop lands on: plate slots and
 * tray positions are independent, and the backend picks the cell for a drop (derive_best_cell). */
export const WELL_ORDER = ["A01", "B01", "C01", "D01", "A02", "B02", "C02", "D02"];

/** The physical carousel position a well sits in - tray bay 1 is wells A01-D01 (index 0-3),
 * bay 2 is A02-D02 (4-7). A physical tray occupies exactly one position, and only one tray
 * can be in a position at a time, so this is the grain at which one tray evicts another. */
function trayPositionGroup(well: string | null): number {
  const idx = well ? WELL_ORDER.indexOf(well) : -1;
  return idx < 0 ? -1 : Math.floor(idx / 4);
}

/**
 * For each physical tray, the founding date of the *next* tray to take over its carousel
 * position - i.e. the day that tray is physically removed from the instrument. A cell keeps a
 * fixed tray/well position for life and two trays can never share one carousel position (see
 * docs/pacbio-sprq-nx-scheduling-reference.md), so once a successor tray is founded in the
 * same position (tray 1 = wells A01-D01, tray 2 = A02-D02), the entire prior tray - every one
 * of its cells, including wells the successor doesn't refill - has necessarily left, and none
 * of its cells can be reused from that day on. Trays with no successor (the one currently
 * loaded in that position) are absent from the map. `cells` should be the wider open+terminal
 * +stopped universe and `trayFoundingDates` built from that same universe, so a later tray's
 * founding is visible even when the prior tray's cells have all gone terminal/stopped.
 */
export function computeTrayEvictionDates(
  cells: CellOut[],
  trayFoundingDates: Map<number, string>,
): Map<number, string> {
  // Per (instrument, position group), the founding date of every tray occupying it. One
  // entry per tray - all four of a tray's cells share a position, so the first is enough.
  const byPosition = new Map<string, { founding: string; trayId: number }[]>();
  const seenTrays = new Set<number>();
  for (const cell of cells) {
    if (cell.tray_id === null || seenTrays.has(cell.tray_id)) continue;
    if (!cell.current_instrument_serial || !cell.current_well) continue;
    const group = trayPositionGroup(cell.current_well);
    if (group < 0) continue;
    const founding = trayFoundingDates.get(cell.tray_id);
    if (!founding) continue;
    seenTrays.add(cell.tray_id);
    const key = `${cell.current_instrument_serial}\u0000${group}`;
    const list = byPosition.get(key);
    if (list) list.push({ founding, trayId: cell.tray_id });
    else byPosition.set(key, [{ founding, trayId: cell.tray_id }]);
  }

  const evictions = new Map<number, string>();
  for (const list of byPosition.values()) {
    list.sort((a, b) => (a.founding < b.founding ? -1 : a.founding > b.founding ? 1 : 0));
    for (const entry of list) {
      const next = list.find((e) => e.founding > entry.founding);
      if (next) evictions.set(entry.trayId, next.founding);
    }
  }
  return evictions;
}
