import { api } from "./client";
import type { RunOut, RunTimeHours } from "@/types/schedule";
import type { MoveSampleRequest, PlaceSampleRequest } from "@/types/schedulerGrid";

export interface CellUseOut {
  id: number;
  /** The owning Cycle (plate) id - a cell use belongs to one plate/acquisition. */
  cycle_id: number;
  cell_id: number;
  cell_code: string | null;
  sample_id: number | null;
  sample_pool_id: string | null;
  well: string;
  run_time_hours: number;
  status: string;
  barcodes: string[];
  outcome_notes: string | null;
  notes: string | null;
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
  /** Set/clear the free-text note on a placement. Not gated by the run lock - a note
   * stays editable after the run is confirmed. Blank clears it. */
  updateNotes: (id: number, notes: string) => api.patch<CellUseOut>(`/api/cell-uses/${id}/notes`, { notes }),
  /** Change one well's own movie / run time (12/24/30 h). Returns the owning run's refreshed
   * RunOut (its representative run time / planned end may change). 409 if the run is locked
   * or the placement isn't planned. */
  updateRunTime: (id: number, runTimeHours: RunTimeHours) =>
    api.patch<RunOut>(`/api/cell-uses/${id}/run-time`, { run_time_hours: runTimeHours }),
  /** Place a backlog sample into a slot. 201 -> the updated RunOut for that
   * (instrument_serial, load_date). 400/409 on clash/lock. */
  place: (req: PlaceSampleRequest) => api.post<RunOut>("/api/cell-uses", req),
  /** Remove a placement. 204 no body; 409 if the owning run isn't "planned". */
  remove: (id: number) => api.del<void>(`/api/cell-uses/${id}`),
  /** Atomically remove many placements in one request/transaction - the "Clear schedule"
   * and multi-select "Remove from schedule" actions. Doing it server-side in one transaction
   * (rather than one concurrent DELETE per stage) can't race the empty-plate cleanup and
   * leave an orphaned cycle behind (a stale instrument lock). Ids that can't be removed are
   * skipped and reported in `failed` rather than failing the whole batch. */
  bulkRemove: (cellUseIds: number[]) =>
    api.post<{ removed_count: number; removed_ids: number[]; failed: { cell_use_id: number; reason: string }[] }>(
      "/api/cell-uses/bulk-remove",
      { cell_use_ids: cellUseIds },
    ),
  /** Atomically move an existing placement to a different (instrument, day, slot). 200 ->
   * the destination RunOut. 409 on a cross-instrument move, lock, or slot clash. */
  move: (id: number, req: MoveSampleRequest) => api.post<RunOut>(`/api/cell-uses/${id}/move`, req),
  /** Reverse a mistaken Failed/Aborted verdict (from Mark Failed, a Stop cell's
   * triggering use, or a whole-cycle abort), restoring the use (and its sample) to how
   * they looked beforehand. 409 if the sample has since moved on (requeued or
   * rescheduled elsewhere) - undo is no longer safe once that's happened. */
  undo: (id: number) => api.post<CellUseOut>(`/api/cell-uses/${id}/undo`),
  /** Exchange which sample sits on two already-placed cell uses; neither placement's
   * day/well/cell changes. 200 -> the 1-2 touched RunOuts. 409 on a lock, a
   * cancelled/non-planned use, or a cross-cell barcode clash. */
  swap: (id: number, otherCellUseId: number) =>
    api.post<RunOut[]>(`/api/cell-uses/${id}/swap`, { other_cell_use_id: otherCellUseId }),
  /** Recover a cancelled ("Blocked") slot left behind by a cell discard: delete the dead
   * placement and return its sample to the backlog. 409 if the block came from a Stop cell
   * (a permanent QC marker) rather than a discard. */
  returnToBacklog: (id: number) => api.post<{ sample_id: number | null }>(`/api/cell-uses/${id}/return-to-backlog`),
};
