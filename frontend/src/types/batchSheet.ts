/** Backend-schema mirror for the printable batch sheet (see backend/app/schemas/batch_sheet.py).
 * A per-load-day loading sheet: one section per run, its 1-2 plates (each with its own
 * acquisition date), and for each well which cell/sample goes where. */

export interface BatchSheetWellOut {
  well: string;
  slot_index: number; // grid position 0-7 (Plate 1: 0-3, Plate 2: 4-7)
  plate_number: 1 | 2; // which plate this well is on
  cell_ref: string;
  use_number: number;
  run_time_hours: number; // this well's own movie / run time (12/24/30) - per-cell, may differ within a run
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
  notes: string | null;
}

export interface BatchSheetPlateOut {
  plate_number: 1 | 2;
  acquire_date: string; // YYYY-MM-DD - the day this plate sequences (Plate 1 == the run's load day)
  is_reuse: boolean; // True = reuses Plate 1's cells on a later day; False = Plate 1 or a fresh parallel Plate 2
  movie_hours: number;
  wells: BatchSheetWellOut[];
}

export interface BatchSheetRunOut {
  instrument_serial: string;
  instrument_name: string;
  run_id: number;
  run_name: string | null;
  load_date: string; // YYYY-MM-DD
  status: string;
  plates: BatchSheetPlateOut[];
}

export interface BatchSheetOut {
  load_date: string; // YYYY-MM-DD
  runs: BatchSheetRunOut[];
}
