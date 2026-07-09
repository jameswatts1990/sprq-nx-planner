import { api, buildQuery } from "./client";
import type { CycleOut } from "@/types/schedule";

export interface CycleStatusUpdate {
  status: string;
  at?: string;
  actor?: string;
}

export interface ListCyclesParams {
  instrument_serial?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
}

export const cyclesApi = {
  list: (params: ListCyclesParams = {}) => api.get<CycleOut[]>(`/api/cycles${buildQuery(params)}`),
  get: (id: number) => api.get<CycleOut>(`/api/cycles/${id}`),
  updateStatus: (id: number, req: CycleStatusUpdate) => api.patch<CycleOut>(`/api/cycles/${id}`, req),
};
