import { api } from "./client";
import type { CycleOut } from "@/types/schedule";
import type { PlaceSampleRequest } from "@/types/schedulerGrid";

export interface CellUseOut {
  id: number;
  cycle_id: number;
  cell_id: number;
  cell_code: string | null;
  sample_id: number | null;
  sample_external_id: string | null;
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
  /** Place a backlog sample into a slot. 201 -> the updated CycleOut for that
   * (instrument_serial, run_date). 400/409 on clash/lock. */
  place: (req: PlaceSampleRequest) => api.post<CycleOut>("/api/cell-uses", req),
  /** Remove a placement. 204 no body; 409 if the owning cycle isn't "planned". */
  remove: (id: number) => api.del<void>(`/api/cell-uses/${id}`),
};
