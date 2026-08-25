import { api, buildQuery } from "./client";
import type { ClearBacklogResult, ClearResult, RowPage, TableInfo } from "@/types/admin";

export interface ListRowsParams {
  page?: number;
  page_size?: number;
}

/** URL for the full-database JSON export. The endpoint sets Content-Disposition, so a hidden
 * <a download> (or navigating to it) saves a file rather than rendering JSON — which is why
 * this bypasses the JSON `api` client, same as scheduleExportUrl. */
export function adminExportUrl(): string {
  return "/api/admin/export.json";
}

export const adminApi = {
  listTables: () => api.get<TableInfo[]>("/api/admin/tables"),
  listRows: (table: string, params: ListRowsParams = {}) =>
    api.get<RowPage>(`/api/admin/tables/${table}/rows${buildQuery(params)}`),
  deleteRow: (table: string, rowId: string | number) => api.del<void>(`/api/admin/tables/${table}/rows/${rowId}`),
  updateRow: (table: string, rowId: string | number, values: Record<string, unknown>) =>
    api.patch<Record<string, unknown>>(`/api/admin/tables/${table}/rows/${rowId}`, { values }),
  clearTable: (table: string) => api.post<ClearResult>(`/api/admin/tables/${table}/clear`),
  clearBacklog: () => api.post<ClearBacklogResult>("/api/admin/clear-backlog"),
};
