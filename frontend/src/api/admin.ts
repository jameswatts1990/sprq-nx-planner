import { api, buildQuery } from "./client";
import type { ClearResult, RowPage, TableInfo } from "@/types/admin";

export interface ListRowsParams {
  page?: number;
  page_size?: number;
}

export const adminApi = {
  listTables: () => api.get<TableInfo[]>("/api/admin/tables"),
  listRows: (table: string, params: ListRowsParams = {}) =>
    api.get<RowPage>(`/api/admin/tables/${table}/rows${buildQuery(params)}`),
  deleteRow: (table: string, rowId: string | number) => api.del<void>(`/api/admin/tables/${table}/rows/${rowId}`),
  clearTable: (table: string) => api.post<ClearResult>(`/api/admin/tables/${table}/clear`),
};
