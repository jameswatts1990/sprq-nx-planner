import type { CellOut } from "@/types/cell";
import { CELL_LIFETIME_H } from "@/utils/windowFade";

/**
 * Buckets every currently-open cell's physical tray by the instrument it's sitting on,
 * deduping to one entry per distinct tray - a tray contributes up to `tray_size` rows to
 * the same open-cells fetch, but only counts once. Cells with no `tray_id` (pre-tray-
 * feature or bootstrap-cutover cells - see cell_service.py's open_new_tray/bootstrap_cell)
 * have no physical tray to group into, so they're excluded here even though they still
 * show in the plain cell list elsewhere. Preserves first-seen order, which - since the
 * backend returns cells newest-first - naturally surfaces the most recently opened tray
 * first within an instrument.
 */
export function groupOpenTrayIdsByInstrument(cells: CellOut[]): Map<string, number[]> {
  const byInstrument = new Map<string, number[]>();
  const seenTrayIds = new Set<number>();

  for (const cell of cells) {
    if (cell.tray_id === null || !cell.current_instrument_serial) continue;
    if (seenTrayIds.has(cell.tray_id)) continue;
    seenTrayIds.add(cell.tray_id);

    let trayIds = byInstrument.get(cell.current_instrument_serial);
    if (!trayIds) {
      trayIds = [];
      byInstrument.set(cell.current_instrument_serial, trayIds);
    }
    trayIds.push(cell.tray_id);
  }

  return byInstrument;
}

/** Total distinct open trays across every instrument - drives the accordion's badge. */
export function countOpenTrays(byInstrument: Map<string, number[]>): number {
  let count = 0;
  for (const trayIds of byInstrument.values()) count += trayIds.length;
  return count;
}

/** Hours left before this cell's own 108h window closes, or null if its window hasn't
 * started yet (never used) or it's no longer racing the clock (exhausted/retired/
 * stopped/already window_expired - see cellStatus.ts). */
export function windowHoursRemaining(cell: CellOut): number | null {
  if (cell.status !== "open" || cell.window_hours_elapsed === null) return null;
  return CELL_LIFETIME_H - cell.window_hours_elapsed;
}

/** Soonest window closure across a tray's sibling cells, for surfacing tray-level
 * urgency in the Open trays list - null if no sibling has an active window (e.g. every
 * cell in the tray is still unused). */
export function soonestTrayExpiry(cells: CellOut[]): number | null {
  let soonest: number | null = null;
  for (const cell of cells) {
    const remaining = windowHoursRemaining(cell);
    if (remaining === null) continue;
    if (soonest === null || remaining < soonest) soonest = remaining;
  }
  return soonest;
}
