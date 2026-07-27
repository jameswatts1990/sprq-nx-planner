import { api, buildQuery } from "./client";
import type { SampleTopupOut } from "@/types/topup";

export interface ListTopupsParams {
  /** "pending" = not yet requested, "sent" = request sent. Omit for all. */
  status?: "pending" | "sent";
}

export const topupsApi = {
  list: (params: ListTopupsParams = {}) => api.get<SampleTopupOut[]>(`/api/topups${buildQuery(params)}`),
  /** Confirm the top-up request went out - stamps today's date on the entry. */
  requestSent: (id: number) => api.post<SampleTopupOut>(`/api/topups/${id}/request-sent`),
  /** Cancel (delete) a top-up requirement; the sample itself is untouched. */
  cancel: (id: number) => api.del<void>(`/api/topups/${id}`),
};
