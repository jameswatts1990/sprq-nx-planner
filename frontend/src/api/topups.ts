import { api, buildQuery } from "./client";
import type { SampleTopupOut } from "@/types/topup";

/** Resupply requests ("top-ups" in the API/DB names). */
export interface ListTopupsParams {
  /** "pending" = not yet sent, "sent" = request sent. Omit for all. */
  status?: "pending" | "sent";
  /** Only this sample's requests (its detail page). */
  sample_id?: number;
}

export const topupsApi = {
  list: (params: ListTopupsParams = {}) => api.get<SampleTopupOut[]>(`/api/topups${buildQuery(params)}`),
  /** Confirm the resupply request went out - stamps today's date on the entry. */
  requestSent: (id: number) => api.post<SampleTopupOut>(`/api/topups/${id}/request-sent`),
  /** Cancel (delete) a resupply request; the sample itself is untouched. */
  cancel: (id: number) => api.del<void>(`/api/topups/${id}`),
};
