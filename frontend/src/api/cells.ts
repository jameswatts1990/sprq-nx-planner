import { api, buildQuery } from "./client";
import type {
  CellBootstrapRequest,
  CellDetailOut,
  CellOut,
  CellReportToPacbioRequest,
  CellStopOut,
  CellStopRequest,
} from "@/types/cell";
import type { Page } from "@/types/common";

export interface ListCellsParams {
  status?: string;
  instrument_serial?: string;
  qc_status?: "unreported" | "awaiting_credit";
  q?: string;
  page?: number;
  page_size?: number;
}

export const cellsApi = {
  list: (params: ListCellsParams = {}) => api.get<Page<CellOut>>(`/api/cells${buildQuery(params)}`),
  get: (id: number) => api.get<CellDetailOut>(`/api/cells/${id}`),
  bootstrap: (req: CellBootstrapRequest) => api.post<CellDetailOut>("/api/cells/bootstrap", req),
  retire: (id: number) => api.post<CellOut>(`/api/cells/${id}/retire`),
  stop: (id: number, req: CellStopRequest) => api.post<CellStopOut>(`/api/cells/${id}/stop`, req),
  reportToPacbio: (id: number, req: CellReportToPacbioRequest) =>
    api.post<CellOut>(`/api/cells/${id}/report-to-pacbio`, req),
  confirmCredit: (id: number) => api.post<CellOut>(`/api/cells/${id}/confirm-credit`, {}),
  receiveCredit: (id: number) => api.post<CellOut>(`/api/cells/${id}/receive-credit`, {}),
};
