import { api } from "./client";
import type { CycleOut } from "@/types/schedule";
import type { ChangeCellRequest, MoveSampleRequest, PlaceSampleRequest } from "@/types/schedulerGrid";

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
  /** Atomically move an existing placement to a different (instrument, day, slot). 200 ->
   * the destination CycleOut. 409 on a cross-instrument move, lock, or slot clash. */
  move: (id: number, req: MoveSampleRequest) => api.post<CycleOut>(`/api/cell-uses/${id}/move`, req),
  /** Reassign an existing placement to a different cell, same slot. 200 -> the owning
   * CycleOut. 409 on an incompatible/locked target cell or a locked run. */
  changeCell: (id: number, req: ChangeCellRequest) => api.post<CycleOut>(`/api/cell-uses/${id}/change-cell`, req),
  /** Reverse a mistaken Failed/Aborted verdict (from Mark Failed, a Stop cell's
   * triggering use, or a whole-cycle abort), restoring the use (and its sample) to how
   * they looked beforehand. 409 if the sample has since moved on (requeued or
   * rescheduled elsewhere) - undo is no longer safe once that's happened. */
  undo: (id: number) => api.post<CellUseOut>(`/api/cell-uses/${id}/undo`),
};
