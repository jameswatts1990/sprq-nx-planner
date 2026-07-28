import type { SampleStatus } from "./common";

export interface SampleOut {
  id: number;
  /** The sample identifier, shown to users as "Container ID". */
  external_id: string;
  parent_sample: string | null;
  sanger_ids: string[];
  target_oplc: number | null;
  volume: number | null;
  /** Loading-dilution volumes (µL) that pre-fill the batch sheet's SOP 7.3 worksheet. */
  cleaned_complex_volume: number | null;
  loading_buffer_volume: number | null;
  control_dilution_3_volume: number | null;
  adaptive_loading: string | null;
  full_resolution_base_q: string | null;
  priority: string | null;
  ccs_kinetics: string | null;
  /** Desired movie / acquisition time (h): 12, 24, or 30. Null for samples created before
   * this field existed — treated as the 24 h default wherever it's shown or used as the
   * placement run-time default. */
  movie_time_hours: number | null;
  status: SampleStatus;
  /** QC disposition tag ("repeatable"/"recoverable") when a Cell QC action returned this
   * sample to the backlog - groups it into the Backlog's "Recoverable Samples" section. */
  qc_disposition: string | null;
  barcodes: string[];
  import_batch_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SampleCreate {
  external_id: string;
  barcodes: string[];
  sanger_ids?: string[];
  parent_sample?: string | null;
  target_oplc?: number | null;
  volume?: number | null;
  cleaned_complex_volume?: number | null;
  loading_buffer_volume?: number | null;
  control_dilution_3_volume?: number | null;
  adaptive_loading?: string | null;
  full_resolution_base_q?: string | null;
  priority?: string | null;
  ccs_kinetics?: string | null;
  movie_time_hours?: number | null;
}

/** Edit-a-backlog-sample payload: same editable fields as create, minus the Container ID
 * (external_id), which identifies the sample and is fixed once created. */
export type SampleUpdate = Omit<SampleCreate, "external_id">;

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
