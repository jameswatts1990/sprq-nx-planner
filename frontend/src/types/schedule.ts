/** Mirrors backend/app/schemas/schedule.py exactly - field names are the wire format
 * (no camelCase transform layer), so this file is the source of truth for the
 * frontend/backend contract. Keep it in lockstep with that file. */

export type MaxUses = 1 | 2 | 3;
export type RunTimeHours = 12 | 24 | 30;
export type Objective = "fewest" | "balance" | "fastest";

export interface RunDesignSettings {
  instrument_ids: string[];
  max_uses: MaxUses;
  run_time_hours: RunTimeHours;
  objective: Objective;
  start_date: string; // YYYY-MM-DD
}

export interface ConflictPairOut {
  a: string;
  b: string;
  shared: string[];
}

export interface WindowFlagOut {
  cell_ref: string;
  span_hours: number;
}

export interface KPIOut {
  total_acq: number;
  fresh_cells: number;
  prior_cells: number;
  trays: number;
  nx_cost: number;
  single_cost: number;
  savings: number;
  savings_pct: number;
  duration_days: number;
  machines: number;
}

export interface NotesOut {
  conflict_pairs: ConflictPairOut[];
  unplaced_sample_ids: number[];
  window_flags: WindowFlagOut[];
}

export interface StageOut {
  cell_ref: string;
  cell_id: number | null;
  cell_is_prior: boolean;
  cell_use_id: number | null;
  sample_id: number | null;
  sample_external_id: string | null;
  barcodes: string[];
  well: string;
  stage_no: number;
}

export interface CycleOut {
  machine_idx: number;
  instrument_serial: string;
  batch_idx: number;
  use_idx: number;
  day_idx: number;
  time_of_day_hours: number;
  end_day_idx: number;
  stages: StageOut[];
  cycle_id: number | null;
  status: string | null;
  planned_start_at: string | null;
  planned_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
}

export interface PackedCellUseOut {
  sample_id: number | null;
  sample_external_id: string;
  barcodes: string[];
}

export interface PackedCellOut {
  cell_ref: string;
  cell_id: number | null;
  is_prior: boolean;
  burned_barcodes: string[];
  future_uses: number;
  total_uses: number;
  cost_tier: number;
  window_hours: number;
  instrument_serial: string | null;
  stage_no: number | null;
  uses: PackedCellUseOut[];
}

export interface PreviewRequest {
  settings: RunDesignSettings;
  excluded_cell_ids?: number[];
  sample_ids?: number[] | null;
}

export interface PreviewResponse {
  kpi: KPIOut;
  notes: NotesOut;
  cells: PackedCellOut[];
  cycles: CycleOut[];
  backlog_hash: string;
}

export interface CommitRequest {
  settings: RunDesignSettings;
  expected_backlog_hash: string;
  excluded_cell_ids?: number[];
  sample_ids?: number[] | null;
  actor?: string | null;
}

export interface ScheduleOut {
  id: number;
  created_at: string;
  created_by: string;
  status: "active" | "cancelled";
  start_date: string;
  settings_json: Record<string, unknown>;
  kpi: KPIOut | null;
}

export interface ScheduleDetailOut extends ScheduleOut {
  cycles: CycleOut[];
}
