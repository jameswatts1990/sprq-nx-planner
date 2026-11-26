import type { CellType } from "./common";

/** The RunNx run (and, when found, the cell use) an MLWH well was loaded as. */
export interface QcReviewMatch {
  /** run_name: the RunNx run carries this Traction run name. instrument_date: the RunNx run has
   * no run name, so it was matched by instrument + load day - worth a second look. */
  by: "run_name" | "instrument_date";
  run_batch_id: number;
  run_label: string;
  /** Null when RunNx has the run but nothing in this plate/well. */
  cell_use_id: number | null;
  cell_id: number | null;
  cell_code: string | null;
  cell_type: CellType | null;
  cell_status: string | null;
  use_number: number | null;
  use_status: string | null;
  sample_id: number | null;
  pool_id: string | null;
  /** False when RunNx's Pool ID isn't one of the library tubes MLWH loaded in this well. */
  pool_matches: boolean | null;
  /** Whether Confirm fail can run the Cell QC Fail on this use now; when not, why. */
  can_fail: boolean;
  blocked_reason: string | null;
  /** RunNx has no use to fail here (nothing in the well, or the run was recorded completed/aborted),
   * so the well is logged as a case without a cell instead. False while it just can't be failed yet. */
  log_instead: boolean;
}

export interface QcReviewIgnore {
  reason: string;
  ignored_by: string | null;
  ignored_at: string;
}

/** One SMRT-cell well the QC team failed in LangQC (MLWH). Timestamps are MLWH's, as recorded. */
export interface QcReviewWell {
  /** "<Traction run name>|<plate>|<well>" - the well's identity across RunNx and MLWH. */
  key: string;
  run_name: string;
  plate_number: number;
  well_label: string;
  instrument_name: string | null;
  qc_state: string;
  qc_date: string | null;
  well_start: string | null;
  well_complete: string | null;
  smrt_cell_id: string | null;
  cell_lot: string | null;
  cell_use_count: number | null;
  is_multi_use: boolean | null;
  sequencing_kit: string | null;
  movie_name: string | null;
  movie_minutes: number | null;
  loading_conc: number | null;
  hifi_yield_gb: number | null;
  library_barcodes: string[];
  sample_count: number;
  smrt_link_url: string | null;
  match: QcReviewMatch | null;
  ignored: QcReviewIgnore | null;
}

/** GET /api/qc/review. MLWH unset (configured=false) or unreachable (ok=false + error) are states
 * the page shows, never request failures. */
export interface QcReview {
  configured: boolean;
  ok: boolean;
  error: string | null;
  lookback_days: number;
  /** YYYY-MM-DD - the start of the lookback window. */
  since: string;
  pending: QcReviewWell[];
  ignored: QcReviewWell[];
  /** Failed wells in the window RunNx already has a fail on / that were logged from the queue. */
  already_failed: number;
  already_logged: number;
}
