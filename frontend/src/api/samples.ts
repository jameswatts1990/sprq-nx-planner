import { api, buildQuery } from "./client";
import type { Page } from "@/types/common";
import type { SampleCreate, SampleDetailOut, SampleOut } from "@/types/sample";

export type SampleSortBy = "created_at" | "external_id" | "barcode" | "priority";
export type SampleSortDir = "asc" | "desc";

export interface ListSamplesParams {
  status?: string;
  q?: string;
  priority?: string;
  sort_by?: SampleSortBy;
  sort_dir?: SampleSortDir;
  page?: number;
  page_size?: number;
}

export const samplesApi = {
  list: (params: ListSamplesParams = {}) => api.get<Page<SampleOut>>(`/api/samples${buildQuery(params)}`),
  create: (body: SampleCreate) => api.post<SampleOut>("/api/samples", body),
  listPriorities: () => api.get<string[]>("/api/samples/priorities"),
  get: (id: number) => api.get<SampleDetailOut>(`/api/samples/${id}`),
  cancel: (id: number) => api.post<SampleOut>(`/api/samples/${id}/cancel`),
  requeue: (id: number) => api.post<SampleOut>(`/api/samples/${id}/requeue`),
};
