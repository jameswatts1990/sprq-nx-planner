import { api, buildQuery } from "./client";
import type { AuditLogOut } from "@/types/audit";
import type { Page } from "@/types/common";

export interface ListAuditParams {
  entity_type?: string;
  entity_id?: number;
  /** Rows about this run / sample / cell, including the placements on it. */
  run_id?: number;
  sample_id?: number;
  cell_id?: number;
  actor?: string;
  /** One action, or a comma-separated group (utils/auditLabels ACTION_GROUPS). */
  action?: string;
  q?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}

export const auditApi = {
  list: (params: ListAuditParams = {}) => api.get<Page<AuditLogOut>>(`/api/audit-log${buildQuery(params)}`),
  /** Everyone who has made a change, A→Z. */
  actors: () => api.get<string[]>("/api/audit-log/actors"),
};
