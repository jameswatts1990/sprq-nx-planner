/** Backend-schema mirror for the run-oriented scheduler (Cycle + Stage). Field names
 * are the wire format (no camelCase transform layer), so this file is the source of
 * truth for the frontend/backend contract - keep it in lockstep with the backend
 * schemas. The old Schedule/preview/commit/KPI/PackedCell types were removed when the
 * live drag-and-drop Schedule page replaced the debounced preview-then-commit Plan page. */

import type { CycleStatus } from "./common";

export type MaxUses = 1 | 2 | 3;
export type RunTimeHours = 12 | 24 | 30;
export type Objective = "fewest" | "balance" | "fastest";
export type SlotIndex = 0 | 1 | 2 | 3;

export interface StageOut {
  slot_index: SlotIndex;
  well: string;
  cell_use_id: number;
  cell_id: number;
  cell_ref: string; // Cell.code
  /** 1-based position of this cell_use among its cell's loads - drives the Use 1/2/3 colour. */
  use_number: number;
  sample_id: number | null;
  sample_external_id: string | null;
  barcodes: string[];
}

export interface CycleOut {
  cycle_id: number;
  instrument_serial: string;
  run_date: string; // YYYY-MM-DD, absolute
  movie_hours: number;
  status: CycleStatus;
  planned_start_at: string; // ISO datetime
  planned_end_at: string;
  actual_start_at: string | null;
  actual_end_at: string | null;
  /** length 1-4, ONLY filled wells - pad to slot_index 0-3 for rendering. */
  stages: StageOut[];
}
