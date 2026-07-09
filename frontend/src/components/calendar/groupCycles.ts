import type { CycleOut } from "@/types/schedule";

/**
 * Groups cycles by (instrument_serial, day_idx) for calendar cell placement -
 * `instrument_serial` is the field to group by, not `machine_idx` (an internal
 * ordinal that doesn't necessarily match the instruments selected for a preview).
 * Each per-day list is sorted by time_of_day_hours so cycles render in chronological
 * order within a cell.
 */
export function groupCyclesByInstrumentAndDay(cycles: CycleOut[]): Map<string, Map<number, CycleOut[]>> {
  const byInstrument = new Map<string, Map<number, CycleOut[]>>();

  for (const cycle of cycles) {
    let byDay = byInstrument.get(cycle.instrument_serial);
    if (!byDay) {
      byDay = new Map();
      byInstrument.set(cycle.instrument_serial, byDay);
    }
    const list = byDay.get(cycle.day_idx);
    if (list) {
      list.push(cycle);
    } else {
      byDay.set(cycle.day_idx, [cycle]);
    }
  }

  for (const byDay of byInstrument.values()) {
    for (const list of byDay.values()) {
      list.sort((a, b) => a.time_of_day_hours - b.time_of_day_hours);
    }
  }

  return byInstrument;
}
