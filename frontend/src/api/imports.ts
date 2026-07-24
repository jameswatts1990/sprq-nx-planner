import { api, buildQuery } from "./client";
import type { Page } from "@/types/common";
import type {
  ImportBatchOut,
  ImportField,
  ImportPreviewRequest,
  ImportPreviewResult,
  ImportRequest,
  ImportResult,
  SchedulerConvertRequest,
  SchedulerConvertResult,
} from "@/types/importing";

export const importsApi = {
  create: (req: ImportRequest) => api.post<ImportResult>("/api/imports", req),
  /** Non-committing: returns the file's columns + a suggested field->column mapping. */
  preview: (req: ImportPreviewRequest) => api.post<ImportPreviewResult>("/api/imports/preview", req),
  /** Non-committing: pool a scheduler sheet (CSV text) into the standard import CSV. */
  schedulerConvert: (req: SchedulerConvertRequest) =>
    api.post<SchedulerConvertResult>("/api/imports/scheduler-convert", req),
  /** The canonical importable fields (mapping targets + add-sample form). */
  fields: () => api.get<ImportField[]>("/api/imports/fields"),
  list: (page = 1, pageSize = 50) =>
    api.get<Page<ImportBatchOut>>(`/api/imports${buildQuery({ page, page_size: pageSize })}`),
  get: (id: number) => api.get<ImportBatchOut & { raw_text: string }>(`/api/imports/${id}`),
};

/** Download URL for the blank import template (server sets Content-Disposition). */
export function importTemplateUrl(): string {
  return "/api/imports/template.csv";
}
