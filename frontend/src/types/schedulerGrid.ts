/** View-model + request/response contract types for the interactive Schedule grid.
 * Separate from types/schedule.ts (the raw Cycle/Stage backend mirror) because these
 * describe the drag-and-drop grid surface and its mutation payloads. */

import type { CycleOut, MaxUses, Objective, RunTimeHours, SlotIndex } from "./schedule";

/** How a placed sample gets its cell: a brand-new cell, or an existing reusable one. */
export type CellChoice = { mode: "new" } | { mode: "existing"; cell_id: number };

/** POST /api/cell-uses body. */
export interface PlaceSampleRequest {
  sample_id: number;
  instrument_serial: string;
  run_date: string; // YYYY-MM-DD
  slot_index: SlotIndex;
  cell_choice: CellChoice;
  run_time_hours: RunTimeHours; // current Run Design dial
  max_uses: MaxUses; // current Run Design dial; only applied server-side when cell_choice.mode==="new"
}

export interface GridCellRef {
  instrument_serial: string;
  run_date: string; // YYYY-MM-DD
}

/** POST /api/auto-fill body. */
export interface AutoFillRequest {
  cells: GridCellRef[];
  max_uses: MaxUses;
  run_time_hours: RunTimeHours;
  objective: Objective;
}

export interface AutoFillWindowFlag {
  cell_ref: string;
  span_hours: number;
}

/** POST /api/auto-fill response. */
export interface AutoFillResponse {
  placed_sample_ids: number[];
  unplaced_sample_ids: number[];
  skipped_cells: GridCellRef[];
  window_flags: AutoFillWindowFlag[];
  runs: CycleOut[]; // every cycle touched
}

/** The three Run Design dials, held in page state and threaded into place/auto-fill. */
export interface RunDesignState {
  max_uses: MaxUses;
  run_time_hours: RunTimeHours;
  objective: Objective;
}

/** A minimal sample reference carried by a drag operation - covers both a backlog
 * sample and a sample being moved out of a filled slot (built from its StageOut). */
export interface DragSampleRef {
  id: number;
  external_id: string;
  barcodes: string[];
}

/** Captured on drag-end and used to open the CellChoicePicker before committing. */
export interface PendingPlacement {
  sample: DragSampleRef;
  instrument_serial: string;
  run_date: string;
  slot_index: SlotIndex;
  /** Present when moving a sample from an existing filled slot: remove this use first. */
  moveFromCellUseId?: number;
}
