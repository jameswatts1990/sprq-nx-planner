import { api, buildQuery } from "./client";
import type { CycleStatus } from "@/types/common";
import type { CycleOut } from "@/types/schedule";

export interface CycleStatusUpdate {
  status: CycleStatus;
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
  /** PATCH /api/cycles/{id} {status} -> updated CycleOut. Used for the Confirm-loaded
   * (status:"running") and Unlock (status:"planned") controls. */
  updateStatus: (id: number, req: CycleStatusUpdate) => api.patch<CycleOut>(`/api/cycles/${id}`, req),
  /** POST /api/cycles/{id}/cancel -> 204 no body. */
  cancel: (id: number) => api.post<void>(`/api/cycles/${id}/cancel`),
};
