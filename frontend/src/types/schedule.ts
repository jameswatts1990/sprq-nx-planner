/** Backend-schema mirror for the run-oriented scheduler (Cycle + Stage). Field names
 * are the wire format (no camelCase transform layer), so this file is the source of
 * truth for the frontend/backend contract - keep it in lockstep with the backend
 * schemas. The old Schedule/preview/commit/KPI/PackedCell types were removed when the
 * live drag-and-drop Schedule page replaced the debounced preview-then-commit Plan page. */

import type { CycleStatus } from "./common";

export type MaxUses = 1 | 2 | 3;
export type RunTimeHours = 12 | 24 | 30;
export type Objective = "fewest" | "balance" | "fastest";
/** 0-3 = tray 1, 4-7 = tray 2 (two 4-cell trays loaded per run). */
export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

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
  /** This specific use's own status (planned/started/completed/failed/cancelled). */
  cell_use_status: string;
  /** The physical cell's overall status (open/exhausted/window_expired/retired/stopped). */
  cell_status: string;
  /** 1-4 position within this cell's physical SPRQ-Nx SMRT Cell tray - null for cells
   * with no tray (created before this feature, or via the bootstrap cutover tool). */
  tray_position: number | null;
  /** The physical tray this cell belongs to - lets the grid's per-tray "Discard Cells"
   * action target every sibling cell, not just the ones with a filled slot this cycle. */
  tray_id: number | null;
  /** Hours elapsed since this cell's own first use (null if not started yet) - drives the
   * slot's expiry shading. Per-cell, not per-tray - see docs/pacbio-sprq-nx-scheduling-
   * reference.md #2 (no shared tray-level clock). */
  window_hours_elapsed: number | null;
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
  /** planned_start_at + movie_hours + LOCK_BUFFER_HOURS - when the instrument becomes
   * available to *start* another run (loading the next run's cells is never blocked). */
  lock_until: string; // ISO datetime
  /** "now" falls within [planned_start_at, lock_until) and status isn't aborted/completed. */
  is_locked: boolean;
  /** length 1-8, ONLY filled wells - pad to slot_index 0-7 for rendering. */
  stages: StageOut[];
}
