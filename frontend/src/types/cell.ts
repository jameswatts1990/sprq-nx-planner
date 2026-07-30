import type { CellStatus } from "./common";

export interface CellUseHistoryOut {
  id: number;
  run_batch_id: number;
  cycle_id: number;
  // Which plate (1 or 2) this use loaded on - drives the plate-qualified well label (P1_A01),
  // since the stored `well` alone can't disambiguate the plate (a reuse Plate 2 stores A01-D01).
  plate_index: number | null;
  run_name: string | null;
  well: string;
  status: string;
  sample_id: number | null;
  sample_external_id: string | null;
  sample_priority: string | null;
  sample_target_oplc: number | null;
  sample_adaptive_loading: string | null;
  sample_full_resolution_base_q: string | null;
  sample_base_kinetics: string | null;
  barcodes: string[];
  instrument_serial: string | null;
  started_at: string | null;
  completed_at: string | null;
  outcome_notes: string | null;
  // True once this use's run has reached its scheduled start time, independent of
  // whether anyone has explicitly confirmed the run loaded yet.
  run_started: boolean;
  // True while a Failed/Aborted verdict on this use can still be undone - false once the
  // sample has moved on (requeued/rescheduled) since the verdict.
  undo_available: boolean;
  // Cell QC reconciliation: this use was shifted onto this cell by a tray re-zip
  // (reassigned), and/or now shares a burned barcode with another use of this cell.
  reassigned?: boolean;
  barcode_clash?: boolean;
}

/** Compact per-use record carried on every CellOut (the list view), so a cell card can
 * link straight to each sample/run the cell has been used by without fetching its full
 * detail. A leaner cousin of CellUseHistoryOut - just the ids the card links on, plus
 * status/run_started so it can tell an already-run use from a still-scheduled one. */
export interface CellUseSummaryOut {
  id: number;
  run_batch_id: number;
  run_name: string | null;
  sample_id: number | null;
  sample_external_id: string | null;
  well: string;
  status: string;
  run_started: boolean;
  // When this use's run begins (its actual start once confirmed, else the plate's planned
  // start) - the anchor its physical breakout is staggered from. Lets the schedule tray map's
  // live "now" reading count how many of a cell's uses have actually broken out by a given
  // instant. null when the use has no cycle to anchor to.
  breakout_anchor_at: string | null;
}

export interface CellOut {
  id: number;
  code: string;
  max_uses: number;
  status: CellStatus;
  uses_consumed: number;
  uses_remaining: number;
  burned_barcodes: string[];
  window_hours_elapsed: number | null;
  window_breached: boolean;
  current_instrument_serial: string | null;
  current_well: string | null;
  last_use_run_date: string | null;
  first_use_started_at: string | null;
  first_use_planned_start_at: string | null;
  created_at: string;
  stopped_reason: string | null;
  stopped_at: string | null;
  // Discard Cells (weekly schedule grid, per-tray) - forces status to "exhausted"
  // regardless of actual remaining use count.
  discarded_reason: string | null;
  discarded_at: string | null;
  has_failed_use: boolean;
  needs_qc_report: boolean;
  awaiting_credit: boolean;
  pacbio_case_number: string | null;
  pacbio_reported_at: string | null;
  pacbio_credit_confirmed_at: string | null;
  credit_received_at: string | null;
  // Physical SPRQ-Nx SMRT Cell tray (4 cells) this cell belongs to - null for cells
  // created before this feature, or via the one-off bootstrap cutover tool.
  tray_id: number | null;
  tray_position: number | null;
  tray_size: number;
  // Reversible "skip reuse / planning disposal" flag on this cell's physical tray - when
  // true, autoschedule won't reuse any cell in the tray. Distinct from the sticky discard.
  tray_reuse_disabled: boolean;
  // Compact, chronological (earliest-first) history of the samples/runs this cell has been
  // used by - powers the linked container/run list on the cell card.
  uses: CellUseSummaryOut[];
}

export interface CellDetailOut extends CellOut {
  use_history: CellUseHistoryOut[];
}

export interface CellBootstrapRequest {
  uses_consumed: number;
  burned_barcodes: string[];
  first_use_started_at?: string | null;
  actor?: string | null;
}

/** Reason payload for the per-cell "Discard remaining use(s)" action. */
export interface CellDiscardRequest {
  reason?: string | null;
}

export interface CellReportToPacbioRequest {
  case_number: string;
}

export interface TrayDiscardRequest {
  tray_id: number;
  reason?: string | null;
}

export interface TrayDiscardOut {
  cells: CellOut[];
}

/** Toggle a tray's reversible "skip reuse / planning disposal" flag - true to flag it
 * (autoschedule stops reusing the whole tray), false to clear it and restore reuse. */
export interface TraySkipReuseRequest {
  tray_id: number;
  disabled: boolean;
}

export interface TraySkipReuseOut {
  cells: CellOut[];
}

export interface TrayRotateRequest {
  tray_id: number;
  /** The grid day the rotate was triggered from: this day's uses and every later use of
   * the tray move onto the fresh tray; earlier uses stay on the old (discarded) cells. */
  from_date: string;
  reason?: string | null;
}

export interface TrayRotateOut {
  /** The 4 cells of the freshly-minted tray. */
  new_cells: CellOut[];
  /** How many uses moved from the old tray onto the new one. */
  moved_count: number;
}
