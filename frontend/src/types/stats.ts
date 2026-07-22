/** Mirrors backend/app/schemas/stats.py (StatsResponse). Weeks are ISO date strings
 * (Monday of the week). See that file / stats_service.py for the scoping rules: the
 * time-series respect the date/instrument filters; cell/sample/credit figures are
 * current "now" snapshots. */

export interface WeekPoint {
  week: string;
  runs: number;
  samples: number;
}

export interface InstrumentThroughput {
  serial: string;
  name: string | null;
  runs: number;
  cell_uses: number;
}

export interface MovieHoursSlice {
  movie_hours: number;
  count: number;
}

export interface ThroughputStats {
  series: WeekPoint[];
  per_instrument: InstrumentThroughput[];
  movie_hours_mix: MovieHoursSlice[];
}

export interface DepthSlice {
  uses: number;
  cells: number;
}

export interface AvgUsesPoint {
  week: string;
  avg_uses: number;
}

export interface WellFillPoint {
  week: string;
  filled: number;
  capacity: number;
}

export interface WindowWaste {
  full_3_uses: number;
  expired_early: number;
}

export interface ReuseStats {
  depth_distribution: DepthSlice[];
  avg_uses_trend: AvgUsesPoint[];
  well_fill: WellFillPoint[];
  window_waste: WindowWaste;
}

export interface OutcomeSlice {
  status: string;
  count: number;
}

export interface FailureRatePoint {
  week: string;
  failed: number;
  total: number;
}

export interface CreditFunnel {
  needs_report: number;
  reported: number;
  awaiting: number;
  received: number;
}

export interface FailureStats {
  outcomes: OutcomeSlice[];
  failure_rate_trend: FailureRatePoint[];
  credit_funnel: CreditFunnel;
}

export interface StatusSlice {
  status: string;
  count: number;
}

export interface ImportVolumePoint {
  week: string;
  imported: number;
}

export interface InventoryStats {
  cell_status: StatusSlice[];
  sample_funnel: StatusSlice[];
  import_volume: ImportVolumePoint[];
}

export interface HeadlineStats {
  runs_completed: number;
  samples_completed: number;
  avg_uses_per_cell: number;
  pct_reaching_use3: number;
  failure_rate: number;
  well_fill_pct: number;
  cells_awaiting_credit: number;
  credits_received: number;
}

export interface StatsResponse {
  headline: HeadlineStats;
  throughput: ThroughputStats;
  reuse: ReuseStats;
  failures: FailureStats;
  inventory: InventoryStats;
}
