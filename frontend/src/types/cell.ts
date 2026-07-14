import type { CellStatus } from "./common";

export interface CellUseHistoryOut {
  id: number;
  run_batch_id: number;
  cycle_id: number;
  well: string;
  status: string;
  sample_id: number | null;
  sample_external_id: string | null;
  barcodes: string[];
  instrument_serial: string | null;
  started_at: string | null;
  completed_at: string | null;
  outcome_notes: string | null;
}

export interface CellOut {
  id: number;
  code: string;
  max_uses: number;
  status: CellStatus;
  uses_consumed: number;
  uses_remaining: number;
  burned_barcodes: string[];
  window_hours_elapsed: number | null;
  window_breached: boolean;
  current_instrument_serial: string | null;
  current_well: string | null;
  first_use_started_at: string | null;
  created_at: string;
}

export interface CellDetailOut extends CellOut {
  use_history: CellUseHistoryOut[];
}

export interface CellBootstrapRequest {
  uses_consumed: number;
  burned_barcodes: string[];
  first_use_started_at?: string | null;
  actor?: string | null;
}
