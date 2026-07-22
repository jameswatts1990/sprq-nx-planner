import { api, buildQuery } from "./client";
import type { StatsResponse } from "@/types/stats";

export interface StatsParams {
  date_from?: string;
  date_to?: string;
  instrument_serial?: string;
}

export const statsApi = {
  get: (params: StatsParams = {}) => api.get<StatsResponse>(`/api/stats${buildQuery(params)}`),
};
