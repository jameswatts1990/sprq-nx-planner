export type DowntimeKind = "planned" | "unplanned";

/** One out-of-service period (backend services/downtime.py). Every day start_date..end_date is
 * down, INCLUSIVE; end_date null = open-ended, down until brought back online. Planned and
 * unplanned gate scheduling the same way - only Stats tells them apart. */
export interface DowntimeOut {
  id: number;
  start_date: string; // ISO date
  end_date: string | null; // ISO date, the LAST down day
  kind: DowntimeKind;
  note: string | null;
  created_by: string | null;
  created_at: string; // ISO datetime
}

export interface DowntimeIn {
  start_date: string;
  end_date: string | null;
  kind: DowntimeKind;
  note: string | null;
}

/** A run with a plate acquiring inside a downtime period - listed when the period is saved,
 * never moved. `plates` = which of its plates (1/2) acquire inside it. */
export interface AffectedRunOut {
  run_id: number;
  load_date: string;
  run_name: string | null;
  status: string;
  plates: number[];
}

export interface DowntimeWriteOut {
  downtime: DowntimeOut | null; // null once an End removed a period that hadn't started
  instrument: InstrumentOut;
  affected_runs: AffectedRunOut[];
}

export interface InstrumentOut {
  id: number;
  serial_number: string;
  name: string | null;
  // Descriptive lab-record metadata (nothing in scheduling reads these): where the instrument
  // lives and its asset-register number. Edited from the instrument card's Edit dialog.
  location: string | null;
  asset_number: string | null;
  active: boolean;
  // Downtime periods, oldest first (utils/downtime.ts reads them). down_now = a period covers
  // today; next_downtime = the first one starting after today. down_from/down_note are derived
  // from the current period, else the next one. Distinct from `active` (permanently retired).
  downtimes: DowntimeOut[];
  down_now: boolean;
  next_downtime: DowntimeOut | null;
  down_from: string | null; // ISO date
  down_note: string | null;
  is_locked: boolean;
  locked_until: string | null; // ISO datetime
}

export interface InstrumentCreate {
  serial_number: string;
  name?: string | null;
  location?: string | null;
  asset_number?: string | null;
  active?: boolean;
}

export interface InstrumentUpdate {
  name?: string | null;
  location?: string | null;
  asset_number?: string | null;
  active?: boolean | null;
}

export interface InstrumentStatsOut {
  id: number;
  serial_number: string;
  running_run_name: string | null;
  running_run_id: number | null; // id behind running_run_name, for the History run-detail link
  free_at: string | null; // ISO datetime
  open_tray_count: number;
  cell_open_count: number;
  cell_total_count: number;
  last_run_date: string | null; // ISO date
  total_runs: number;
  next_run_date: string | null; // ISO date
  // Live per-cell state right now (see backend cell_timing.instrument_activity). Capacity facts:
  // cells_sequencing <= 4, cells_in_ppa <= 2; prep_locked = a fresh load can't start yet because
  // cells are still breaking out (awaiting prep / prepping).
  cells_awaiting_prep: number;
  cells_prepping: number;
  cells_sequencing: number;
  cells_in_ppa: number;
  prep_locked: boolean;
}
