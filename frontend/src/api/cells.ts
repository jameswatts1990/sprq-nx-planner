import { api, buildQuery } from "./client";
import type { CellBootstrapRequest, CellDetailOut, CellOut } from "@/types/cell";
import type { Page } from "@/types/common";

export interface ListCellsParams {
  status?: string;
  instrument_serial?: string;
  q?: string;
  page?: number;
  page_size?: number;
}

export const cellsApi = {
  list: (params: ListCellsParams = {}) => api.get<Page<CellOut>>(`/api/cells${buildQuery(params)}`),
  get: (id: number) => api.get<CellDetailOut>(`/api/cells/${id}`),
  bootstrap: (req: CellBootstrapRequest) => api.post<CellDetailOut>("/api/cells/bootstrap", req),
  retire: (id: number) => api.post<CellOut>(`/api/cells/${id}/retire`),
};
