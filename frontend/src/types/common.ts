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

export const CYCLE_STATUSES = ["planned", "running", "completed", "aborted"] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const CELL_USE_STATUSES = ["planned", "started", "completed", "failed", "cancelled"] as const;
export type CellUseStatus = (typeof CELL_USE_STATUSES)[number];
