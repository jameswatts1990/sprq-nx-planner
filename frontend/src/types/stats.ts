/** Mirrors backend/app/schemas/stats.py (StatsResponse). Each series point's `period` is the ISO
 * date its week (Monday), month or quarter starts, per `group_by`. See that file /
 * stats_service.py for the scoping rules: the time-series respect the date/instrument filters and
 * count runs by their derived status and load date; cell/sample/credit figures are current "now"
 * snapshots. */

export type GroupBy = "week" | "month" | "quarter";

export interface PeriodPoint {
  period: string;
  runs_completed: number;
  /** Wells on completed runs that didn't fail or abort. */
  samples_sequenced: number;
  /** Runs loading in the period that are still planned. */
  planned_runs: number;
}

export interface InstrumentThroughput {
  serial: string;
  name: string | null;
  runs_completed: number;
  samples_sequenced: number;
}

export interface MovieHoursSlice {
  movie_hours: number;
  /** Wells loaded with this movie time. */
  count: number;
}

export interface ThroughputStats {
  series: PeriodPoint[];
  per_instrument: InstrumentThroughput[];
  movie_hours_mix: MovieHoursSlice[];
}

export interface DepthSlice {
  uses: number;
  cells: number;
}

export interface AvgUsesPoint {
  period: string;
  avg_uses: number;
}

export interface PlateFillPoint {
  period: string;
  filled: number;
  /** 4 wells x plates loaded. */
  capacity: number;
}

export interface WindowWaste {
  full_3_uses: number;
  expired_early: number;
}

export interface ReuseStats {
  depth_distribution: DepthSlice[];
  avg_uses_trend: AvgUsesPoint[];
  plate_fill: PlateFillPoint[];
  window_waste: WindowWaste;
}

export interface OutcomeSlice {
  status: string;
  count: number;
}

export interface FailureRatePoint {
  period: string;
  failed: number;
  /** Wells loaded in the period. */
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
  period: string;
  imported: number;
}

export interface InventoryStats {
  cell_status: StatusSlice[];
  sample_funnel: StatusSlice[];
  import_volume: ImportVolumePoint[];
}

export interface HeadlineStats {
  runs_completed: number;
  samples_sequenced: number;
  planned_runs: number;
  avg_uses_per_cell: number;
  pct_reaching_use3: number;
  /** Failed of wells loaded, 0-100. */
  failure_rate: number;
  /** Wells used of 4 per plate loaded, 0-100. */
  plate_fill_pct: number;
  cells_awaiting_credit: number;
  credits_received: number;
}

export interface StatsResponse {
  group_by: GroupBy;
  headline: HeadlineStats;
  throughput: ThroughputStats;
  reuse: ReuseStats;
  failures: FailureStats;
  inventory: InventoryStats;
}
