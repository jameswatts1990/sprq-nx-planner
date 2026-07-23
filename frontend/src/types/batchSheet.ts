/** Backend-schema mirror for the printable batch sheet (see backend/app/schemas/batch_sheet.py). */

export interface BatchSheetWellOut {
  well: string;
  slot_index: number; // 0-3 = tray 1, 4-7 = tray 2
  cell_ref: string;
  use_number: number;
  cell_window_deadline: string | null; // ISO datetime
  window_breached: boolean;
  sample_id: number | null;
  sample_external_id: string | null;
  barcodes: string[];
  adaptive_loading: string | null;
  ccs_kinetics: string | null;
  full_resolution_base_q: string | null;
  target_oplc: number | null;
  volume: number | null;
}

export interface BatchSheetInstrumentOut {
  instrument_serial: string;
  instrument_name: string;
  cycle_id: number;
  movie_hours: number;
  status: string;
  planned_start_at: string;
  planned_end_at: string;
  wells: BatchSheetWellOut[];
}

export interface BatchSheetOut {
  run_date: string; // YYYY-MM-DD
  instruments: BatchSheetInstrumentOut[];
}
