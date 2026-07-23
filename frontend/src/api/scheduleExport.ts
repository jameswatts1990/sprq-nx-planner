import { buildQuery } from "./client";

export interface ScheduleExportParams {
  date_from?: string;
  date_to?: string;
  instrument_serial?: string;
}

/** URL for the sequencing-tracker CSV download. The endpoint sets Content-Disposition,
 * so navigating to it (or a hidden <a download>) triggers a file save rather than JSON —
 * which is why this bypasses the JSON `api` client. */
export function scheduleExportUrl(params: ScheduleExportParams = {}): string {
  return `/api/schedule/export.csv${buildQuery(params)}`;
}
