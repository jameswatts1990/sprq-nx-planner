/** Backend-schema mirror for the run-oriented scheduler (Run + Plate + Stage). Field names
 * are the wire format (no camelCase transform layer), so this file is the source of
 * truth for the frontend/backend contract - keep it in lockstep with backend/app/schemas/
 * run.py. A "run" is now a SMRT Link run design: one physical load session on one
 * instrument (RunOut, keyed by load_date), holding 1-2 plates (PlateOut, each an
 * acquisition round with its own acquire_date). A reuse run reads as one run whose Plate 2
 * acquires a later day. */

import type { CycleStatus } from "./common";

export type MaxUses = 1 | 2 | 3;
export type RunTimeHours = 12 | 24 | 30;
export type Objective = "fewest" | "balance" | "fastest" | "utilisation";
/** How many of a run's 8 wells auto-fill is allowed to use per acquisition day: 4 = Plate 1
 * only (1 tray), 8 = both plates (2 trays). Surfaced in the UI as "Plates per run". */
export type CellsPerDay = 4 | 8;
/** Grid POSITION within a run, 0-7: Plate 1 -> 0-3, Plate 2 -> 4-7. NOT the physical well
 * index - a reuse Plate 2 sits in the same wells (A01-D01) as Plate 1, so its stages carry
 * slot_index 4-7 while their `well` repeats A01-D01. */
export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface StageOut {
  /** Grid position 0-7: Plate 1 -> 0-3, Plate 2 -> 4-7 (see SlotIndex). */
  slot_index: SlotIndex;
  /** The true SMRT Link well label. For a reuse Plate 2 this repeats A01-D01 (same physical
   * wells as Plate 1), even though slot_index is 4-7. */
  well: string;
  cell_use_id: number;
  cell_id: number;
  cell_ref: string; // Cell.code
  /** 1-based position of this cell_use among its cell's loads - drives the Use 1/2/3 colour. */
  use_number: number;
  /** This well's own movie / run time (h). Per-cell: set from the Run Design dial on
   * placement/auto-schedule, editable per-cell in the slot-detail popover. Different wells of
   * one run may differ; PlateOut.movie_hours is the longest of its plate's wells. */
  run_time_hours: RunTimeHours;
  sample_id: number | null;
  sample_external_id: string | null;
  barcodes: string[];
  /** This specific use's own status (planned/started/completed/failed/cancelled). */
  cell_use_status: string;
  /** The physical cell's overall status (open/exhausted/window_expired/retired/stopped). */
  cell_status: string;
  /** True if any use of this cell has a recorded "failed" outcome - lets the grid tell an
   * earlier, still-untouched use apart from the one a Stop cell was actually triggered
   * from once the cell goes "stopped" (see SchedulerSlotView's qcAlert). */
  cell_has_failed_use: boolean;
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
  /** Free-text note the user attached to this sample-on-this-cell placement, shown and
   * editable in the slot-detail popover. Distinct from the QC outcome note. */
  notes: string | null;
}

/** One acquisition round within a run (a persisted Cycle). Up to 4 wells. Plate 1 acquires
 * on the run's load_date; Plate 2 acquires the same day (fresh parallel second tray) or a
 * later weekday (reuse of Plate 1's cells). */
export interface PlateOut {
  plate_id: number; // the Cycle id
  plate_index: 1 | 2; // which sample plate / loading position
  acquire_date: string; // YYYY-MM-DD - the day THIS plate sequences (== run.load_date for Plate 1)
  /** True when this plate reuses an earlier plate's cells (same tray, a later acquire_date) -
   * its wells show Use >= 2. False for Plate 1 and for a fresh parallel Plate 2. */
  is_reuse: boolean;
  /** This plate's representative run time: the longest of its wells' per-cell run_time_hours. */
  movie_hours: number;
  status: CycleStatus;
  planned_start_at: string; // ISO datetime
  planned_end_at: string;
  actual_start_at: string | null;
  actual_end_at: string | null;
  /** ONLY filled wells - pad to slot_index 0-7 for rendering (see padStages). */
  stages: StageOut[];
}

export interface RunOut {
  run_id: number; // the RunBatch id
  instrument_serial: string;
  load_date: string; // YYYY-MM-DD - the day the whole run is physically loaded (one session)
  /** Optional lab-assigned label (e.g. "TRACTION-RUN-1234") set when the run is locked
   * (Confirm loaded) - overrides "#<run_id>" everywhere a run is displayed. */
  run_name: string | null;
  /** Derived run-level status: "running"/"completed" once its plates are, else "planned". */
  status: CycleStatus;
  /** The instrument is held until the last plate's acquisition finishes + buffer - when it
   * becomes available to *start* another run (loading the next run's cells is never blocked). */
  lock_until: string; // ISO datetime
  /** "now" falls within the run's load -> last-acquisition window and it isn't aborted/completed. */
  is_locked: boolean;
  /** 1-2 plates. Plate 1 first; a second plate is a fresh parallel tray or a reuse. */
  plates: PlateOut[];
}
