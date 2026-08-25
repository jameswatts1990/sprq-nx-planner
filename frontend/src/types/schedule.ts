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
/** The auto-schedule strategies the UI surfaces, stored as the engine's own mode names so
 * they pass straight through to /api/auto-fill (which still accepts the wider legacy set -
 * see backend/app/schemas/run.py). The UI labels them "Fastest", "Efficient" and "By order"
 * (see RunDesignFields.OBJECTIVE_OPTIONS):
 *   - "utilisation" ("Fastest"): open enough distinct fresh cells to fill the tray so
 *     every sample starts as soon as possible - each cell then carries an expiry timer.
 *   - "fewest" ("Efficient"): reuse a cell to its Max-uses depth before opening the next,
 *     so fewer cells have a running 108h window at once.
 *   - "order" ("By order"): place samples strictly in the sequence they were uploaded, and
 *     within each upload the order their rows appeared in the CSV (fills the grid day-by-day
 *     in that sequence; ignores priority). Uses the same fill-a-tray cell choice as "Fastest". */
export type Objective = "fewest" | "utilisation" | "order";
/** Per-day cap on how many samples auto-fill may schedule on one instrument: 4 = one sample
 * plate, 8 = two. A cap on samples, NOT a cell-tray count - the samples run on cells drawn from
 * whatever tray(s) are loaded (either carousel bay). Surfaced in the UI as "Plates per run". */
export type CellsPerDay = 4 | 8;
/** Grid POSITION within a run, 0-7: Plate 1 -> 0-3, Plate 2 -> 4-7. NOT the physical well
 * index - a reuse Plate 2 sits in the same wells (A01-D01) as Plate 1, so its stages carry
 * slot_index 4-7 while their `well` repeats A01-D01. */
export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface StageOut {
  /** Grid position 0-7: Plate 1 -> 0-3, Plate 2 -> 4-7 (see SlotIndex). */
  slot_index: SlotIndex;
  /** The plate LOADING position this sample was dropped onto (drives slot_index). A grid slot
   * is a loading position, not a cell - which physical cell runs here is separate (cell_id /
   * cell_home_well). For a reuse Plate 2 this can repeat A01-D01 even though slot_index is 4-7. */
  well: string;
  cell_use_id: number;
  cell_id: number;
  cell_ref: string; // Cell.code
  /** The physical cell's own tray identity well (A01-D01 / A02-D02) - its fixed A/B/C/D tray
   * position, distinct from `well` (the loading slot). Drives the ticket-stub letter (e.g.
   * "B1" = tray position B, Use 1) so the stub names the real cell even when the sample sits in
   * a different plate slot. Null for a legacy/bootstrap cell with no tray. */
  cell_home_well: string | null;
  /** 1-based position of this cell_use among its cell's loads - drives the Use 1/2/3 colour. */
  use_number: number;
  /** The physical cell's own use cap (usually 3; lower only if QC reduced it). With use_number
   * this gives the cell's remaining uses (cell_max_uses - use_number) shown on the Revio-screen
   * panel's "Remaining SMRT Cell uses" boxes. */
  cell_max_uses: number;
  /** This well's own movie / run time (h). Per-cell: set from the Run Design dial on
   * placement/auto-schedule, editable per-cell in the slot-detail popover. Different wells of
   * one run may differ; PlateOut.movie_hours is the longest of its plate's wells. */
  run_time_hours: RunTimeHours;
  sample_id: number | null;
  sample_pool_id: string | null;
  /** Library insert / fragment size (bp) of the sample in this slot, or null if not recorded.
   * Drives the grid card's "[<5kb]" flag and the small-insert-on-reuse warning (a small-insert
   * sample sitting on use_number >= 2). The threshold is admin-configurable (read client-side). */
  insert_size_bp: number | null;
  /** Duplicate marker for the sample in this slot: when its Pool ID is carried by more
   * than one sample (any status), duplicate_total is the count and duplicate_index this copy's
   * 1-based position. Both null/absent for a one-off — the grid card shows "1/3" only when set. */
  duplicate_index?: number | null;
  duplicate_total?: number | null;
  /** True when this cell was already used by another copy of the exact same Pool ID (a
   * sibling duplicate sharing a barcode) - an intentionally ALLOWED reuse, not a clash: reusing
   * a cell with the identical sample can't misattribute reads to a foreign sample, so there's
   * no cross-contamination risk the barcode-clash rule exists to prevent. Shown so it's
   * transparent at a glance rather than a silent exception. See docs/pacbio-sprq-nx-scheduling-
   * reference.md's barcode-carryover rule. */
  duplicate_cell_reuse?: boolean;
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
  /** True when this is a REUSE (Use 2/3) whose plate's planned start has slipped past the cell's
   * 108h reuse deadline - it can no longer physically start in time. Drives the card's "⚠ Window"
   * flag and the slot/cell popover's out-of-window Note + "Load fresh tray" action. False for a
   * first use and for any in-window reuse. Estimated until Use 1 is confirmed. */
  reuse_window_exceeded?: boolean;
  /** Advisory only, never blocks a placement - hours by which this use's own start preceded
   * its cell's real physical readiness (the prior use's movie end + the on-board reuse wash).
   * null when this is the cell's first use, or the start was already safely at/after
   * readiness. A distinct clock from window_hours_elapsed's 108h lifetime check. Only
   * populated on placement/move/auto-fill responses, null on the plain grid feed. */
  reuse_not_ready_hours: number | null;
  /** Free-text note the user attached to this sample-on-this-cell placement, shown and
   * editable in the slot-detail popover. Distinct from the QC outcome note. */
  notes: string | null;
  /** Cell QC reconciliation: true if a QC tray re-zip shifted this acquisition onto a
   * different physical cell than planned (drives a "reassigned" grid marker). */
  reassigned?: boolean;
  /** True if that reassignment landed on a cell that already burned a clashing barcode. */
  barcode_clash?: boolean;
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
  /** Derived (never stored): when this run's cells actually break out once the instrument's OTHER
   * resident runs' sequencing-lane occupancy is accounted for. Only populated on placement / move /
   * auto-fill responses (null on the grid feed). If it's meaningfully later than the chosen load
   * time, the load was accepted but the cells queue — surfaced to the user as an advisory. */
  effective_start_at: string | null;
  /** True when effective_start_at is meaningfully later than the run's own load time. */
  starts_later_than_requested: boolean;
  /** 1-2 plates. Plate 1 first; a second plate is a fresh parallel tray or a reuse. */
  plates: PlateOut[];
}
