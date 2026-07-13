import type { CycleOut, StageOut } from "@/types/schedule";

import { SLOT_INDICES } from "./gridKeys";

/**
 * Groups cycles by (instrument_serial, run_date) for grid-cell placement. Analogous to
 * the old calendar's groupCyclesByInstrumentAndDay, but keyed by the absolute run_date
 * string instead of a relative day_idx, and holding a single CycleOut per cell (the new
 * model has exactly one cycle per instrument+day). Any (instrument, date) pair with no
 * entry is a fully-empty grid cell.
 */
export function groupCyclesByInstrumentAndDay(cycles: CycleOut[]): Map<string, Map<string, CycleOut>> {
  const byInstrument = new Map<string, Map<string, CycleOut>>();

  for (const cycle of cycles) {
    let byDate = byInstrument.get(cycle.instrument_serial);
    if (!byDate) {
      byDate = new Map();
      byInstrument.set(cycle.instrument_serial, byDate);
    }
    byDate.set(cycle.run_date, cycle);
  }

  return byInstrument;
}

/**
 * Expands a cycle's sparse `stages` (only filled wells) into a fixed length-4 array
 * indexed by slot_index, with `null` for empty slots - the shape the 4-slot grid cell
 * renders from.
 */
export function padStages(cycle: CycleOut | undefined): (StageOut | null)[] {
  const slots: (StageOut | null)[] = [null, null, null, null];
  if (cycle) {
    for (const stage of cycle.stages) {
      if (SLOT_INDICES.includes(stage.slot_index)) slots[stage.slot_index] = stage;
    }
  }
  return slots;
}
