/** The PacBio credit-workflow stage fields every credit case carries - a cell's own case
 * (CellOut) and a case logged without a cell (PacbioCaseOut) alike, so the stage helpers in
 * utils/creditCase and the shared stage actions work on either. */
export interface CreditCaseState {
  internal_report_id: string | null;
  internal_report_at: string | null;
  pacbio_case_number: string | null;
  pacbio_reported_at: string | null;
  pacbio_credit_confirmed_at: string | null;
  credit_acquisitions: number | null;
  credit_notes: string | null;
  credit_received_at: string | null;
  /** Who is chasing the case (a Sanger ID or a name) - free text, the app has no auth. */
  credit_owner: string | null;
}

// Stage-action request bodies - identical for /api/cells/{id}/... and /api/pacbio-cases/{id}/...

export interface CreditReportToPacbioRequest {
  case_number: string;
}

export interface CreditInternalReportRequest {
  /** The report ID the failure is filed under internally (e.g. 26_NC_S_004). */
  report_id: string;
}

export interface CreditConfirmRequest {
  /** Number of acquisitions PacBio confirmed they will credit for this case. */
  acquisitions: number;
}

export interface CreditOwnerRequest {
  /** Empty clears it. */
  owner: string | null;
}

export interface CreditNotesRequest {
  /** Free-text note on the credit case, editable at any stage. Empty clears it. */
  notes: string | null;
}
