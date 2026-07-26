export interface InstrumentOut {
  id: number;
  serial_number: string;
  name: string | null;
  active: boolean;
  // "Down for maintenance": the date it went down (null = online). is_down is derived as
  // down_from != null. Distinct from `active` (permanently retired / hidden from the schedule).
  down_from: string | null; // ISO date
  down_note: string | null;
  is_locked: boolean;
  locked_until: string | null; // ISO datetime
}

export interface InstrumentCreate {
  serial_number: string;
  name?: string | null;
  active?: boolean;
}

export interface InstrumentUpdate {
  name?: string | null;
  active?: boolean | null;
}

export interface InstrumentMaintenanceIn {
  down_from: string; // ISO date
  note?: string | null;
}

export interface InstrumentStatsOut {
  id: number;
  serial_number: string;
  running_run_name: string | null;
  free_at: string | null; // ISO datetime
  open_tray_count: number;
  cell_open_count: number;
  cell_total_count: number;
  last_run_date: string | null; // ISO date
  total_runs: number;
  next_run_date: string | null; // ISO date
}
