import { api, buildQuery } from "./client";
import type { CycleStatus } from "@/types/common";
import type { RunOut } from "@/types/schedule";

export interface CycleStatusUpdate {
  status: CycleStatus;
  at?: string;
  actor?: string;
  /** Only meaningful when status is "running" (locking the run) - see cycles.py. */
  run_name?: string;
  /** Amend the run's load time (the hour it loads and starts sequencing) as part of this
   * update - applied before the status change (the "amend the loading time" at Confirm
   * loaded). Omit to leave the existing start untouched. */
  start_hour?: number;
  start_minute?: number;
}

export interface ListCyclesParams {
  instrument_serial?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
}

/** Path kept as /api/cycles for continuity, but each item is now a *run* (RunBatch): one
 * load session holding 1-2 plates. The {id} path segment is a run id, and the range is a
 * load-date range. */
export const cyclesApi = {
  list: (params: ListCyclesParams = {}) => api.get<RunOut[]>(`/api/cycles${buildQuery(params)}`),
  get: (id: number) => api.get<RunOut>(`/api/cycles/${id}`),
  /** PATCH /api/cycles/{run_id} {status} -> updated RunOut. Operates on the whole run (one
   * Confirm-loaded locks every plate). Used for Confirm-loaded (status:"running") and
   * Unlock (status:"planned"). */
  updateStatus: (id: number, req: CycleStatusUpdate) => api.patch<RunOut>(`/api/cycles/${id}`, req),
  /** POST /api/cycles/{run_id}/cancel -> 204 no body. Cancels the whole run. */
  cancel: (id: number) => api.post<void>(`/api/cycles/${id}/cancel`),
};
