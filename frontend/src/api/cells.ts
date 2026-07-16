import { api, buildQuery } from "./client";
import type {
  CellBootstrapRequest,
  CellDetailOut,
  CellOut,
  CellReportToPacbioRequest,
  CellStopOut,
  CellStopRequest,
  CellUndoStopOut,
} from "@/types/cell";
import type { Page } from "@/types/common";

export interface ListCellsParams {
  status?: string;
  instrument_serial?: string;
  qc_status?: "unreported" | "awaiting_credit";
  q?: string;
  tray_id?: number;
  page?: number;
  page_size?: number;
}

export const cellsApi = {
  list: (params: ListCellsParams = {}) => api.get<Page<CellOut>>(`/api/cells${buildQuery(params)}`),
  get: (id: number) => api.get<CellDetailOut>(`/api/cells/${id}`),
  bootstrap: (req: CellBootstrapRequest) => api.post<CellDetailOut>("/api/cells/bootstrap", req),
  retire: (id: number) => api.post<CellOut>(`/api/cells/${id}/retire`),
  stop: (id: number, req: CellStopRequest) => api.post<CellStopOut>(`/api/cells/${id}/stop`, req),
  /** Reverse a mistaken Stop cell, reopening the cell and reviving every use it cancelled
   * back to "planned" - except one whose sample has since moved on (requeued/rescheduled
   * elsewhere), which stays cancelled to avoid double-booking that sample. */
  undoStop: (id: number) => api.post<CellUndoStopOut>(`/api/cells/${id}/undo-stop`),
  reportToPacbio: (id: number, req: CellReportToPacbioRequest) =>
    api.post<CellOut>(`/api/cells/${id}/report-to-pacbio`, req),
  confirmCredit: (id: number) => api.post<CellOut>(`/api/cells/${id}/confirm-credit`, {}),
  receiveCredit: (id: number) => api.post<CellOut>(`/api/cells/${id}/receive-credit`, {}),
};
