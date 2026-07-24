import { api } from "./client";
import type { CycleOut } from "@/types/schedule";
import type { MoveSampleRequest, PlaceSampleRequest } from "@/types/schedulerGrid";

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
  /** Reverse a mistaken Failed/Aborted verdict (from Mark Failed, a Stop cell's
   * triggering use, or a whole-cycle abort), restoring the use (and its sample) to how
   * they looked beforehand. 409 if the sample has since moved on (requeued or
   * rescheduled elsewhere) - undo is no longer safe once that's happened. */
  undo: (id: number) => api.post<CellUseOut>(`/api/cell-uses/${id}/undo`),
  /** Exchange which sample sits on two already-placed cell uses; neither placement's
   * day/well/cell changes. 200 -> the 1-2 touched CycleOuts. 409 on a lock, a
   * cancelled/non-planned use, or a cross-cell barcode clash. */
  swap: (id: number, otherCellUseId: number) =>
    api.post<CycleOut[]>(`/api/cell-uses/${id}/swap`, { other_cell_use_id: otherCellUseId }),
  /** Recover a cancelled ("Blocked") slot left behind by a cell discard: delete the dead
   * placement and return its sample to the backlog. 409 if the block came from a Stop cell
   * (a permanent QC marker) rather than a discard. */
  returnToBacklog: (id: number) => api.post<{ sample_id: number | null }>(`/api/cell-uses/${id}/return-to-backlog`),
};
