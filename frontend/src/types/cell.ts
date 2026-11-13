import type { CellStatus, CellType } from "./common";
import type { CreditCaseState } from "./credit";

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
  sample_pool_id: string | null;
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
  sample_pool_id: string | null;
  well: string;
  status: string;
  run_started: boolean;
  // When this use's run begins (its actual start once confirmed, else the plate's planned
  // start) - the anchor its physical breakout is staggered from. Lets the schedule tray map's
  // live "now" reading count how many of a cell's uses have actually broken out by a given
  // instant. null when the use has no cycle to anchor to.
  breakout_anchor_at: string | null;
  // What a failed use's credit email / issue report quote - on the list view so the QC worklist
  // builds them without fetching each cell's detail.
  plate_index: number | null;
  instrument_serial: string | null;
  started_at: string | null;
  completed_at: string | null;
  outcome_notes: string | null;
}

export interface CellOut extends CreditCaseState {
  id: number;
  code: string;
  /** SPRQ-Nx (up to 3 uses) or single-use SPRQ - max_uses follows it. */
  cell_type: CellType;
  max_uses: number;
  status: CellStatus;
  uses_consumed: number;
  uses_remaining: number;
  /** Uses booked after the as-of instant (not yet in uses_consumed) - 0 without as_of. */
  uses_scheduled_later: number;
  burned_barcodes: string[];
  window_hours_elapsed: number | null;
  window_breached: boolean;
  current_instrument_serial: string | null;
  current_well: string | null;
  last_use_run_date: string | null;
  /** When the cell is physically free for its next use = its most recent use's prep-aware movie
   * end. Drives the weekly grid's "reusable from" ghost so it invites the day the cell is actually
   * free, not just the next weekday. Null when unused or its last use's run isn't loaded. */
  reuse_ready_at: string | null;
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

/** One use on a ScheduleTrayCellOut - only what the tray panel's live breakout count reads. */
export type ScheduleTrayUseOut = Pick<CellUseSummaryOut, "status" | "breakout_anchor_at">;

/** The Schedule page's tray-panel feed (GET /api/cells/schedule-trays): the CellOut fields the
 * tray maps and the Autoschedule drawer's reuse list read, for every cell of each tray that can
 * still be on an instrument from the viewed week on. A CellOut is assignable to it. */
export type ScheduleTrayCellOut = Pick<
  CellOut,
  | "id"
  | "code"
  | "cell_type"
  | "max_uses"
  | "status"
  | "uses_consumed"
  | "uses_remaining"
  | "window_hours_elapsed"
  | "current_instrument_serial"
  | "current_well"
  | "first_use_started_at"
  | "first_use_planned_start_at"
  | "tray_id"
  | "tray_position"
  | "tray_reuse_disabled"
> & { uses: ScheduleTrayUseOut[] };

/** What the tray founding/eviction maps read (waitingCells.ts and its backend twin,
 * services/schedule_trays.py). */
export type TrayCellLike = Pick<
  ScheduleTrayCellOut,
  "tray_id" | "first_use_started_at" | "first_use_planned_start_at" | "current_instrument_serial" | "current_well"
>;

export interface CellDetailOut extends CellOut {
  use_history: CellUseHistoryOut[];
}

/** One Cells-page row: a physical tray with ALL its cells (position order) plus its tray-level
 * figures. tray_id is null for a cell registered without a tray (it gets a row of its own). */
export interface CellTrayRowOut {
  tray_id: number | null;
  cell_type: CellType;
  instrument_serial: string | null;
  /** Earliest first use across the tray (actual start once loaded, else planned). */
  first_use_at: string | null;
  last_run_date: string | null;
  /** The soonest-closing 108h window among the tray's open cells - hours left at the as-of
   * instant, and the deadline itself. Null when no open cell is racing the clock. */
  expires_in_hours: number | null;
  expires_at: string | null;
  /** Uses still free to book across the tray's open cells (not spent, not booked later). */
  uses_left: number;
  reuse_disabled: boolean;
  cells: CellOut[];
  /** Which cells actually matched the filters/search (the rest are shown as tray-mates). */
  matched_cell_ids: number[];
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

export interface TrayRestoreRequest {
  tray_id: number;
}

export interface TrayRestoreOut {
  /** The tray's cells, now un-discarded (status re-derived from real capacity/window). */
  cells: CellOut[];
  /** Uses moved back onto this tray from a reversed rotate's successor tray. */
  reversed_use_ids: number[];
  /** Uses that couldn't be cleanly reversed (since confirmed loaded, cancelled, or moved off
   * the successor tray) - left where they are, reported so the user knows what wasn't restored. */
  drifted_use_ids: number[];
  /** The successor tray deleted because reversing emptied it (null if none/kept). */
  deleted_tray_id: number | null;
  /** Another physical tray now resident in this tray's carousel bay - the user resolves which
   * stays (null if the bay is clear). */
  bay_conflict_tray_id: number | null;
}
