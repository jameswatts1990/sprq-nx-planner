import type { SampleStatus } from "./common";

export interface SampleOut {
  id: number;
  external_id: string;
  container_id: string | null;
  parent_sample: string | null;
  sanger_ids: string[];
  oplc: number | null;
  target_oplc: number | null;
  volume: number | null;
  adaptive_loading: string | null;
  full_resolution_base_q: string | null;
  priority: string | null;
  ccs_kinetics: string | null;
  status: SampleStatus;
  barcodes: string[];
  import_batch_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SampleCreate {
  external_id: string;
  barcodes: string[];
  sanger_ids?: string[];
  container_id?: string | null;
  parent_sample?: string | null;
  oplc?: number | null;
  target_oplc?: number | null;
  volume?: number | null;
  adaptive_loading?: string | null;
  full_resolution_base_q?: string | null;
  priority?: string | null;
  ccs_kinetics?: string | null;
}

export interface SampleCellUseOut {
  id: number;
  cycle_id: number;
  run_name: string | null;
  run_batch_id: number;
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
