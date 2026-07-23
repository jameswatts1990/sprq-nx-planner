import type { CellStatus } from "./common";

export interface CellUseHistoryOut {
  id: number;
  run_batch_id: number;
  cycle_id: number;
  run_name: string | null;
  well: string;
  status: string;
  sample_id: number | null;
  sample_external_id: string | null;
  sample_priority: string | null;
  sample_target_oplc: number | null;
  sample_adaptive_loading: string | null;
  sample_full_resolution_base_q: string | null;
  sample_ccs_kinetics: string | null;
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

export interface CellStopRequest {
  reason?: string | null;
  /** The specific use that triggered the stop (e.g. the slot being viewed) - optional
   * for a whole-cell Stop with no single use in view. */
  cell_use_id?: number | null;
}

export interface CellStopOut {
  cell: CellOut;
  bumped_sample_ids: number[];
}

export interface CellUndoStopOut {
  cell: CellOut;
  reverted_cell_use_ids: number[];
  // cell_use ids whose sample had already moved on (requeued/rescheduled) since the
  // stop, so its status was deliberately left untouched rather than reverted.
  drifted_cell_use_ids: number[];
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
