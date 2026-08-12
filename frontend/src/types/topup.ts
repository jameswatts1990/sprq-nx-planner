/** A sample-level "top-up" request (fresh material) created when a Cell QC action
 * dispositions a lost sample "Lost". Distinct from the cell-level PacBio credit workflow.
 * request_sent_at is null until the lab confirms the request went out ("Request Sent");
 * "Cancel" deletes the entry. */
export interface SampleTopupOut {
  id: number;
  sample_id: number;
  pool_id: string | null;
  barcodes: string[];
  priority: string | null;
  created_at: string;
  request_sent_at: string | null;
  note: string | null;
  created_by: string | null;
  /** Provenance: the run/cell/well the loss came from (all nullable). */
  source_run_name: string | null;
  source_cell_code: string | null;
  source_well: string | null;
}
