/** What MLWH recorded about RunNx's runs and samples (backend schemas/sequencing.py). Every
 * response carries configured / ok / error: MLWH unset or unreachable is a state to show, never
 * a failed request. Timestamps are MLWH's, as recorded (no timezone). */

export interface MlwhAvailability {
  configured: boolean;
  ok: boolean;
  error: string | null;
}

export type SequencingFlagKind = "pool_differs" | "movie_differs" | "use_differs" | "cell_differs" | "not_in_plan";

/** Where MLWH's record of a well disagrees with RunNx's plan - a warning, never a block. */
export interface SequencingFlag {
  kind: SequencingFlagKind;
  label: string;
  detail: string;
}

/** One SMRT-cell well as MLWH recorded it. */
export interface MlwhWellFacts {
  /** LangQC's verdict; null while there's none yet. */
  qc_state: string | null;
  qc_date: string | null;
  well_start: string | null;
  well_complete: string | null;
  run_status: string | null;
  well_status: string | null;
  smrt_cell_id: string | null;
  cell_lot: string | null;
  cell_use_count: number | null;
  is_multi_use: boolean | null;
  sequencing_kit: string | null;
  movie_name: string | null;
  movie_minutes: number | null;
  loading_conc: number | null;
  hifi_yield_gb: number | null;
  hifi_read_length_kb: number | null;
  p1_pct: number | null;
  library_barcodes: string[];
  sample_count: number;
}

/** One well of a run: RunNx's use and MLWH's record of it. Either side can be missing. */
export interface RunSequencingWell {
  key: string;
  plate_number: number;
  /** RunNx's well (A01-D02) when it has a use here, else Traction's (A1-D1). */
  well: string;
  cell_use_id: number | null;
  cell_id: number | null;
  cell_code: string | null;
  use_number: number | null;
  sample_id: number | null;
  pool_id: string | null;
  planned_hours: number | null;
  planned_oplc: number | null;
  mlwh: MlwhWellFacts | null;
  flags: SequencingFlag[];
}

export interface RunSequencing extends MlwhAvailability {
  /** run_name: found by the run's Traction run name. instrument_date: the run has no name, so its
   * wells were matched by instrument + load day - worth a second look. Null: nothing found yet. */
  matched_by: "run_name" | "instrument_date" | null;
  mlwh_run_name: string | null;
  smrt_link_url: string | null;
  wells: RunSequencingWell[];
}

/** One sample in a pooled loading: what it got out of the cell. */
export interface SequencingMember {
  sanger_sample_id: string | null;
  hifi_gb: number | null;
  pct_of_cell: number | null;
  /** Under 85% of an even share of the pool. */
  below_even: boolean;
  /** One of the sample's own Sanger IDs (marks it in a pool found under another tube). */
  mine: boolean;
}

/** One SMRT cell a library tube was loaded on. */
export interface SequencingLoading {
  key: string;
  run_name: string;
  run_id: number | null;
  plate_number: number;
  well_label: string;
  run_date: string | null;
  tube: string;
  /** Found through one of the sample's Sanger IDs under another tube. */
  via_other_tube: boolean;
  loading_conc: number | null;
  tube_hifi_gb: number | null;
  cell_hifi_gb: number | null;
  pct_of_cell: number | null;
  plex: number;
  hifi_read_length_kb: number | null;
  qc_state: string | null;
  movie_minutes: number | null;
  smrt_link_url: string | null;
  members: SequencingMember[];
}

export interface SequencingSummary {
  cells: number;
  hifi_gb: number;
  last_run_name: string | null;
  last_run_date: string | null;
  last_well: string | null;
  last_loading_conc: number | null;
  last_hifi_gb: number | null;
  last_pct_of_cell: number | null;
  last_plex: number | null;
  last_qc_state: string | null;
}

export interface SequencingSummaries extends MlwhAvailability {
  /** Keyed by sample id; a sample MLWH has no loadings for is absent. */
  samples: Record<string, SequencingSummary>;
}

export interface SequencingHistory extends MlwhAvailability {
  summary: SequencingSummary | null;
  loadings: SequencingLoading[];
}

export interface UseOutcome {
  use: number;
  cells: number;
  median_hifi_gb: number | null;
  median_p1_pct: number | null;
}

export interface SequencingStats extends MlwhAvailability {
  runs_named: number;
  runs_total: number;
  by_use: UseOutcome[];
}
