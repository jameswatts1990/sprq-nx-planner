import type { CellOut } from "./cell";

/** The three QC verdicts the cell-info QC modal offers. */
export type QcVerdict = "fail" | "fail_and_stop" | "retire";

/** Per-sample fate chosen in the disposition step.
 *  - "lost": no material left → the Top-up list.
 *  - "repeatable_complex": re-load straight from the leftover cleaned complex (the cheap repeat,
 *    auto-suggested when enough complex remains) → backlog at Repeatable(0).
 *  - "repeatable": repeat from the library material held in Traction → backlog at Repeatable(0).
 *  - "recoverable": data recoverable → backlog at Recoverable(0).
 * The three non-"lost" values all appear in the Backlog's "Recoverable Samples" section. */
export type Disposition = "lost" | "repeatable_complex" | "repeatable" | "recoverable";

/** One sample touched by a QC verdict, with the scheduling context the disposition modal
 * shows. `role`: "failed" (the failed acquisition, must dispose), "displaced" (shifted off the
 * tray queue's end, must dispose), "reassigned" (ran on a different cell than planned - flag,
 * dispose optional). `barcode_clash` marks a reassignment onto a cell that already burned a
 * clashing barcode. */
export interface AffectedSample {
  sample_id: number;
  pool_id: string | null;
  barcodes: string[];
  /** Sanger sample IDs; >1 means a pool (drives the Traction libraries-vs-pools deep-link). */
  sanger_ids: string[];
  /** Cleaned complex (uL) loaded for this sample, or null when unrecorded. Compared against
   * QcPreviewOut.total_complex_ul / repeat_safe_min_ul to suggest/flag a repeat from complex. */
  cleaned_complex_volume: number | null;
  cell_use_id: number;
  use_number: number;
  run_date: string | null;
  instrument_serial: string | null;
  plate_index: number | null;
  well: string;
  planned_cell_code: string | null;
  actual_cell_code: string | null;
  role: "failed" | "displaced" | "reassigned";
  reassigned: boolean;
  barcode_clash: boolean;
  disposition_required: boolean;
}

export interface QcPreviewRequest {
  verdict: QcVerdict;
  cell_use_id?: number | null;
}

export interface QcPreviewOut {
  verdict: QcVerdict;
  cell_use_id: number | null;
  affected_samples: AffectedSample[];
  requires_disposition: boolean;
  /** Configured total cleaned complex (uL) made per sample, and the leftover (uL) at/above which
   * a repeat from complex is "safe" — the modal derives its volume readout from these. */
  total_complex_ul: number;
  repeat_safe_min_ul: number;
}

export interface QcCommitRequest {
  verdict: QcVerdict;
  cell_use_id?: number | null;
  reason?: string | null;
  /** sample_id -> disposition. Must cover every affected sample whose disposition_required
   * is true; a flagged/clash sample may also be included to escalate it. */
  dispositions: Record<number, Disposition>;
}

export interface QcCommitOut {
  cell: CellOut;
  failed_sample_ids: number[];
  displaced_sample_ids: number[];
  reassigned_cell_use_ids: number[];
  clash_cell_use_ids: number[];
  backlog_sample_ids: number[];
  created_topup_ids: number[];
}

export interface QcUndoOut {
  cell: CellOut;
  reverted_cell_use_ids: number[];
  drifted_cell_use_ids: number[];
  deleted_topup_ids: number[];
}
