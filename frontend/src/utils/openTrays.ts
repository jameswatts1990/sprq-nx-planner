import type { CellOut } from "@/types/cell";

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
