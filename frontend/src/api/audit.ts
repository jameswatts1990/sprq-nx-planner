import { api, buildQuery } from "./client";
import type { AuditLogOut } from "@/types/audit";
import type { Page } from "@/types/common";

export interface ListAuditParams {
  entity_type?: string;
  entity_id?: number;
  actor?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}

export const auditApi = {
  list: (params: ListAuditParams = {}) => api.get<Page<AuditLogOut>>(`/api/audit-log${buildQuery(params)}`),
};
