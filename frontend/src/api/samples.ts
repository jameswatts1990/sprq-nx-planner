import { api, buildQuery } from "./client";
import type { Page } from "@/types/common";
import type { SampleCreate, SampleDetailOut, SampleOut, SampleUpdate } from "@/types/sample";

export type SampleSortBy =
  | "created_at"
  | "updated_at"
  | "external_id"
  | "barcode"
  | "priority"
  | "status"
  | "parent_sample"
  | "sanger_ids"
  | "target_oplc"
  | "actual_oplc"
  | "adaptive_loading"
  | "full_resolution_base_q"
  | "base_kinetics";
export type SampleSortDir = "asc" | "desc";

export interface ListSamplesParams {
  status?: string;
  q?: string;
  priority?: string;
  /** Comma-list of QC disposition tags to include, plus the sentinel "none" (untagged).
   * The Backlog's main list passes "none" to exclude the Recoverable-section rows; the
   * Recoverable section passes "repeatable,recoverable". */
  qc_disposition?: string;
  sort_by?: SampleSortBy;
  sort_dir?: SampleSortDir;
  page?: number;
  page_size?: number;
}

export const samplesApi = {
  list: (params: ListSamplesParams = {}) => api.get<Page<SampleOut>>(`/api/samples${buildQuery(params)}`),
  /** Add a backlog sample. A Container ID seen before returns 409 (detail.code
   * "duplicate_container") unless allowDuplicate is set — the confirm seam for the manual path. */
  create: (body: SampleCreate, allowDuplicate = false) =>
    api.post<SampleOut>(
      `/api/samples${buildQuery({ allow_duplicate: allowDuplicate ? true : undefined })}`,
      body,
    ),
  update: (id: number, body: SampleUpdate) => api.patch<SampleOut>(`/api/samples/${id}`, body),
  listPriorities: (status?: string) =>
    api.get<string[]>(`/api/samples/priorities${buildQuery({ status })}`),
  get: (id: number) => api.get<SampleDetailOut>(`/api/samples/${id}`),
  cancel: (id: number) => api.post<SampleOut>(`/api/samples/${id}/cancel`),
  requeue: (id: number) => api.post<SampleOut>(`/api/samples/${id}/requeue`),
};
