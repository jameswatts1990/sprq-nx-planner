import { api, buildQuery } from "./client";
import type { CellType, CycleStatus, Page } from "@/types/common";
import type { RunHistoryRowOut, RunOut, ScheduleSearchHit } from "@/types/schedule";

export interface CycleStatusUpdate {
  status: CycleStatus;
  at?: string;
  actor?: string;
  /** Only meaningful when status is "running" (locking the run) - see cycles.py. */
  run_name?: string;
  /** Amend the run's load time (the hour it loads; its cells then prep before sequencing) as part of this
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

export type RunHistorySortKey = "load_date" | "run" | "instrument";

export interface ListRunHistoryParams {
  status?: CycleStatus;
  instrument_serial?: string;
  cell_type?: CellType;
  date_from?: string;
  date_to?: string;
  /** Run name / "#id", instrument, load date, or anything on its wells: Pool / Sanger / Plate
   * IDs, barcodes, cell codes, "T12" trays. */
  q?: string;
  sort_by?: RunHistorySortKey;
  sort_dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

/** Path kept as /api/cycles for continuity, but each item is now a *run* (RunBatch): one
 * load session holding 1-2 plates. The {id} path segment is a run id, and the range is a
 * load-date range. */
export const cyclesApi = {
  list: (params: ListCyclesParams = {}) => api.get<RunOut[]>(`/api/cycles${buildQuery(params)}`),
  /** The Run history page's rows - searched, filtered, sorted and paged server-side. */
  listHistory: (params: ListRunHistoryParams = {}) =>
    api.get<Page<RunHistoryRowOut>>(`/api/cycles/history${buildQuery(params)}`),
  /** The Schedule header search: every grid slot, across all weeks, matching a Pool / Plate /
   * Sanger ID, barcode, cell code, "T12" tray or a run's name / "#id" - in grid reading order. */
  search: (q: string, limit = 50) => api.get<ScheduleSearchHit[]>(`/api/cycles/search${buildQuery({ q, limit })}`),
  get: (id: number) => api.get<RunOut>(`/api/cycles/${id}`),
  /** PATCH /api/cycles/{run_id} {status} -> updated RunOut. Operates on the whole run (one
   * Confirm-loaded locks every plate). Used for Confirm-loaded (status:"running") and
   * Unlock (status:"planned"). */
  updateStatus: (id: number, req: CycleStatusUpdate) => api.patch<RunOut>(`/api/cycles/${id}`, req),
  /** POST /api/cycles/{run_id}/cancel -> 204 no body. Cancels the whole run. */
  cancel: (id: number) => api.post<void>(`/api/cycles/${id}/cancel`),
  /** POST /api/cycles/{run_id}/reschedule {new_load_date} -> updated RunOut. Moves a whole
   * planned run (both plates) to another weekday - the "instrument failed to load" flow. A reuse
   * pushed past its 108h window comes back flagged reuse_window_exceeded (see reschedule_run);
   * 409 if the run is confirmed loaded, the day is a weekend/occupied, or the instrument is
   * locked/maintenance-down then. */
  reschedule: (id: number, newLoadDate: string) =>
    api.post<RunOut>(`/api/cycles/${id}/reschedule`, { new_load_date: newLoadDate }),
};
