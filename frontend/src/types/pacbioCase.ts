import type { CreditCaseState } from "./credit";

/** A PacBio credit case logged WITHOUT a RunNx cell (backend models/pacbio_case.py). It runs
 * through the same credit stages as a cell's case, but everything a cell's case derives from
 * its failed use is hand-entered here instead. */
export interface PacbioCaseOut extends CreditCaseState {
  id: number;
  summary: string;
  /** YYYY-MM-DD - when the failure/loss happened. */
  occurred_on: string;
  instrument_id: number | null;
  instrument_serial: string | null;
  run_name: string | null;
  pool_id: string | null;
  /** The lab's own estimate of acquisitions to claim (a cell's case computes this). */
  expected_acquisitions: number | null;
  created_by: string | null;
  created_at: string;
}

/** The editable details. Create and edit both send the whole set (edit is a full replace, so
 * an optional field can be cleared). */
export interface PacbioCaseDetailsIn {
  summary: string;
  occurred_on: string;
  instrument_id: number | null;
  run_name: string | null;
  pool_id: string | null;
  expected_acquisitions: number | null;
}

/** Backfilling an already-progressed case: any stage the lab already has is stamped up front, in
 * stage order, so the case lands at its real stage. */
export interface PacbioCaseCreate extends PacbioCaseDetailsIn {
  pacbio_case_number: string | null;
  internal_report_id: string | null;
  credit_acquisitions: number | null;
  credit_received: boolean;
  credit_owner: string | null;
  credit_notes: string | null;
}
