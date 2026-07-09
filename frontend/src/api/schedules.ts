import { api, buildQuery } from "./client";
import type { Page } from "@/types/common";
import type { ScheduleDetailOut, ScheduleOut } from "@/types/schedule";

export interface ListSchedulesParams {
  status?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}

export const schedulesApi = {
  list: (params: ListSchedulesParams = {}) => api.get<Page<ScheduleOut>>(`/api/schedules${buildQuery(params)}`),
  get: (id: number) => api.get<ScheduleDetailOut>(`/api/schedules/${id}`),
  cancel: (id: number) => api.post<ScheduleOut>(`/api/schedules/${id}/cancel`),
};
