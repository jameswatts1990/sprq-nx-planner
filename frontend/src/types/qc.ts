import type { CellOut } from "./cell";

/** The three QC verdicts the cell-info QC modal offers. */
export type QcVerdict = "fail" | "fail_and_stop" | "retire";

/** Per-sample fate chosen in the disposition step. */
export type Disposition = "lost" | "repeatable" | "recoverable";

/** One sample touched by a QC verdict, with the scheduling context the disposition modal
 * shows. `role`: "failed" (the failed acquisition, must dispose), "displaced" (shifted off the
 * tray queue's end, must dispose), "reassigned" (ran on a different cell than planned - flag,
 * dispose optional). `barcode_clash` marks a reassignment onto a cell that already burned a
 * clashing barcode. */
export interface AffectedSample {
  sample_id: number;
  external_id: string | null;
  barcodes: string[];
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
