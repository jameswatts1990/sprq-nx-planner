/** View-model + request/response contract types for the interactive Schedule grid.
 * Separate from types/schedule.ts (the raw Run/Plate/Stage backend mirror) because these
 * describe the drag-and-drop grid surface and its mutation payloads. */

import type { CellsPerDay, MaxUses, Objective, RunOut, RunTimeHours, SlotIndex } from "./schedule";

/** How a placed sample gets its cell: a brand-new cell, or an existing reusable one. */
export type CellChoice = { mode: "new" } | { mode: "existing"; cell_id: number };

/** POST /api/cell-uses body. */
export interface PlaceSampleRequest {
  sample_id: number;
  instrument_serial: string;
  load_date: string; // YYYY-MM-DD - the run's load day (the grid column dropped into)
  /** Grid position 0-7: 0-3 = Plate 1, 4-7 = Plate 2. */
  slot_index: SlotIndex;
  /** Omit to let the backend DERIVE the cell (reuse-before-new, the same rule auto-fill uses) -
   * what a plain drag-drop sends. An explicit choice overrides it (the cell-stub's "use a
   * different cell" path). */
  cell_choice?: CellChoice;
  /** Omit to inherit the sample's own movie time (Sample.movie_time_hours, default 24 h) -
   * what a plain drag-drop now sends. An explicit value overrides it (e.g. a re-place that
   * carries an existing per-cell run time). */
  run_time_hours?: RunTimeHours;
  /** Only meaningful when this placement creates a brand-new run (the first sample into
   * an empty instrument+day cell) - ignored otherwise, since an existing run's start is
   * already fixed. Omit to accept the backend's default (12:00). */
  start_hour?: number;
  start_minute?: number;
}

/** POST /api/cell-uses/{id}/move body. */
export interface MoveSampleRequest {
  instrument_serial: string;
  load_date: string; // YYYY-MM-DD
  slot_index: SlotIndex;
  run_time_hours: RunTimeHours;
  start_hour?: number;
  start_minute?: number;
  /** Required only when the destination well conflicts with the cell's own established
   * pin (a different well than its other uses), or a different physical cell is already
   * resident there - the dragged cell can't go there, so this resolves which different
   * cell the sample lands on instead. Ignored otherwise. */
  cell_choice?: CellChoice;
}

export interface GridCellRef {
  instrument_serial: string;
  load_date: string; // YYYY-MM-DD
}

/** POST /api/auto-fill body. */
export interface AutoFillRequest {
  cells: GridCellRef[];
  max_uses: MaxUses; // target packing depth for new cells this batch, not a physical cap (always 3)
  /** Movie times (12/24/30 h) ticked in the Autoschedule panel: only backlog samples of these
   * lengths are scheduled, and each placed well runs for its own sample's movie time. 12 h
   * samples go only on cell 1, 30 h only on cell 4 (24 h anywhere). */
  movie_times: RunTimeHours[];
  objective: Objective;
  /** 4 = one tray (Plate 1 only), 8 = both trays (Plate 2 too). Surfaced as "Plates per run". */
  cells_per_day: CellsPerDay;
  start_hour?: number;
  start_minute?: number;
}

/** "Recalculate" next to an instrument's name in the weekly grid: re-pack every one of that
 * instrument's not-yet-loaded (planned) placements from scratch with the current engine
 * rules. Response shape matches AutoFillResponse - a recalculate is just a scoped auto-fill. */
export interface RecalculateRequest {
  instrument_serial: string;
}

export interface AutoFillWindowFlag {
  cell_ref: string;
  span_hours: number;
}

/** Two backlog samples in this batch share a barcode - the engine already keeps them
 * off the same cell (see engine/packing.py's disjoint() check), this just surfaces that
 * a clash existed rather than discarding it. */
export interface AutoFillBarcodeConflict {
  sample_external_id_a: string;
  sample_external_id_b: string;
  shared_barcodes: string[];
}

/** POST /api/auto-fill response. */
export interface AutoFillResponse {
  placed_sample_ids: number[];
  unplaced_sample_ids: number[];
  /** Container IDs (Sample.external_id) parallel to unplaced_sample_ids, so a caller can name
   * which samples landed back in the Backlog instead of showing a bare count. */
  unplaced_external_ids: string[];
  skipped_cells: GridCellRef[];
  window_flags: AutoFillWindowFlag[];
  barcode_conflicts: AutoFillBarcodeConflict[];
  runs: RunOut[]; // every run touched
  disposed_cell_ids: number[]; // cells of trays auto-disposed after the run (whole tray, once every cell hit the dial)
  /** Populated only by Recalculate: samples that landed on a different calendar day than
   * before (not just a different cell/tray) - always empty for an ordinary Auto Schedule call,
   * since a backlog sample has no "before" day to diff against. */
  day_changed_sample_ids: number[];
}

/** The Run Design dials, held in page state and threaded into place/auto-fill. */
export interface RunDesignState {
  max_uses: MaxUses;
  /** Kept for the drag-move mutation's required (but ignored - the move keeps its own) run
   * time; Auto Schedule no longer uses a single run time - see `movie_times`. */
  run_time_hours: RunTimeHours;
  /** Which movie times (12/24/30 h) Auto Schedule includes from the backlog. Only 24 h by
   * default. Each scheduled well runs for its own sample's movie time; 12 h samples are
   * confined to cell 1 and 30 h samples to cell 4. */
  movie_times: RunTimeHours[];
  objective: Objective;
  cells_per_day: CellsPerDay;
  /** The hour (8-20) a newly-created run loads and starts sequencing. Auto Schedule uses it
   * for every run it creates; a manual first-drop pre-selects the load-time wheel to it. */
  load_hour: number;
}

/** A minimal sample reference carried by a drag operation - covers both a backlog
 * sample and a sample being moved out of a filled slot (built from its StageOut). */
export interface DragSampleRef {
  id: number;
  external_id: string;
  barcodes: string[];
}

/** Captured on drag-end and used to open the CellChoicePicker before committing. */
export interface PendingPlacement {
  sample: DragSampleRef;
  instrument_serial: string;
  load_date: string;
  slot_index: SlotIndex;
  /** Present when moving a sample from an existing filled slot: remove this use first. */
  moveFromCellUseId?: number;
  /** The dragged slot's own cell - only present alongside moveFromCellUseId. Lets the
   * picker check whether this cell is pinned to a different well elsewhere (it can't
   * move there itself, so the sample needs a different cell instead - see
   * cellChoiceGate.ts's wellConflict). */
  moveFromCellId?: number;
  /** The dragged slot's own instrument - only present alongside moveFromCellUseId. A move
   * that crosses instruments can never keep the same physical cell (see
   * docs/pacbio-sprq-nx-scheduling-reference.md's "a cell can never move between
   * instruments" invariant), even when the destination happens to reuse the same well
   * label - so this is compared against `instrument_serial` (the destination) to decide
   * wellConflict alongside the well-string comparison. */
  fromInstrumentSerial?: string;
  /** Set when a backlog sample was dropped directly onto a waiting-cell ghost placeholder
   * (see waitingCells.ts) - that drop target already identifies exactly one cell, so the
   * CellChoicePicker uses it without asking, rather than opening for a choice among
   * every compatible cell. */
  preselectedCellId?: number;
}
