import type { SampleStatus } from "./common";

export interface SampleOut {
  id: number;
  /** The sample identifier, shown to users as "Pool ID". */
  pool_id: string;
  plate_id: string | null;
  sanger_ids: string[];
  target_oplc: number | null;
  /** The achieved on-plate loading concentration (pM), distinct from the planned Target OPLC. */
  actual_oplc: number | null;
  /** Loading-dilution volumes (µL) that pre-fill the batch sheet's SOP 7.3 worksheet.
   * (Control Dilution 3 is a fixed 1 µL printed on the batch sheet, so it isn't stored.) */
  cleaned_complex_volume: number | null;
  loading_buffer_volume: number | null;
  adaptive_loading: string | null;
  full_resolution_base_q: string | null;
  priority: string | null;
  base_kinetics: string | null;
  /** Desired movie / acquisition time (h): 12, 24, or 30. Null for samples created before
   * this field existed — treated as the 24 h default wherever it's shown or used as the
   * placement run-time default. */
  movie_time_hours: number | null;
  /** Library insert / fragment size (bp). Null when not recorded; a value at/below the
   * admin-configured threshold drives the "[<5kb]" flag and Auto Schedule's first-use rule. */
  insert_size_bp: number | null;
  status: SampleStatus;
  /** QC disposition tag ("repeatable_complex"/"repeatable"/"recoverable") when a Cell QC action
   * returned this sample to the backlog - groups it into the Backlog's "Recoverable Samples"
   * section. See utils/qcDisposition.ts for the human-readable labels. */
  qc_disposition: string | null;
  barcodes: string[];
  import_batch_id: number | null;
  created_at: string;
  updated_at: string;
  /** Duplicate marker: when this Pool ID is carried by more than one sample (across all
   * statuses, incl. completed), duplicate_total is that count and duplicate_index this copy's
   * 1-based position (oldest first). Both null/absent for a one-off — the "1/3" badge renders
   * only when duplicate_total is set. */
  duplicate_index?: number | null;
  duplicate_total?: number | null;
}

export interface SampleCreate {
  pool_id: string;
  barcodes: string[];
  sanger_ids?: string[];
  plate_id?: string | null;
  target_oplc?: number | null;
  actual_oplc?: number | null;
  cleaned_complex_volume?: number | null;
  loading_buffer_volume?: number | null;
  adaptive_loading?: string | null;
  full_resolution_base_q?: string | null;
  priority?: string | null;
  base_kinetics?: string | null;
  movie_time_hours?: number | null;
  insert_size_bp?: number | null;
}

/** Edit-a-backlog-sample payload: same editable fields as create, minus the Pool ID
 * (pool_id), which identifies the sample and is fixed once created. */
export type SampleUpdate = Omit<SampleCreate, "pool_id">;

export interface SampleCellUseOut {
  id: number;
  cycle_id: number;
  run_name: string | null;
  run_batch_id: number;
  /** Which plate (1 or 2) of the run this use was scheduled on, inferred from the schedule. */
  plate_number: number | null;
  cell_id: number;
  cell_code: string;
  well: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  outcome_notes: string | null;
}

export interface SampleDetailOut extends SampleOut {
  cell_uses: SampleCellUseOut[];
}
