import type { CellType } from "./common";
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
  /** Which kind of cell the case is about - a cell's case reads it off the cell. Decides how
   * credited acquisitions convert to cells (SPRQ-Nx 3 per cell, single-use SPRQ 1). */
  cell_type: CellType;
  created_by: string | null;
  created_at: string;
  /** The MLWH well ("<run>|<plate>|<well>") it was logged from via QC Review, else null. */
  mlwh_well_key: string | null;
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
  cell_type: CellType;
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
  /** Logged from the QC Review queue: the MLWH well it's about (labels the case QC Review and
   * takes the well out of the queue). */
  mlwh_well_key?: string | null;
}
