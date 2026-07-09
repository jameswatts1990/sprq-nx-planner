import { api, buildQuery } from "./client";
import type { Page } from "@/types/common";
import type { ImportBatchOut, ImportRequest, ImportResult } from "@/types/importing";

export const importsApi = {
  create: (req: ImportRequest) => api.post<ImportResult>("/api/imports", req),
  list: (page = 1, pageSize = 50) =>
    api.get<Page<ImportBatchOut>>(`/api/imports${buildQuery({ page, page_size: pageSize })}`),
  get: (id: number) => api.get<ImportBatchOut & { raw_text: string }>(`/api/imports/${id}`),
};
