export interface Page<T> {
  items: T[];
  total: number;
}

export const SAMPLE_STATUSES = [
  "backlog",
  "scheduled",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];

export const CELL_STATUSES = ["open", "exhausted", "window_expired", "retired", "stopped"] as const;
export type CellStatus = (typeof CELL_STATUSES)[number];

/** A physical cell's type, fixed for its whole tray: multi-use SPRQ-Nx (up to 3 uses) or
 * single-use SPRQ. A run is one type across both plates - picked on the load-time dial. */
export type CellType = "sprq_nx" | "sprq";

export const CYCLE_STATUSES = ["planned", "running", "completed", "aborted"] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const CELL_USE_STATUSES = ["planned", "started", "completed", "failed", "aborted", "cancelled"] as const;
export type CellUseStatus = (typeof CELL_USE_STATUSES)[number];
