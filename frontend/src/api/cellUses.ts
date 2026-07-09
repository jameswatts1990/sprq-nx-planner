import { api } from "./client";

export interface CellUseOut {
  id: number;
  cycle_id: number;
  cell_id: number;
  cell_code: string | null;
  sample_id: number | null;
  sample_external_id: string | null;
  use_index: number;
  well: string;
  status: string;
  barcodes: string[];
  outcome_notes: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface CellUseStatusUpdate {
  status: string;
  at?: string;
  notes?: string;
  actor?: string;
}

export const cellUsesApi = {
  get: (id: number) => api.get<CellUseOut>(`/api/cell-uses/${id}`),
  updateStatus: (id: number, req: CellUseStatusUpdate) => api.patch<CellUseOut>(`/api/cell-uses/${id}`, req),
};
