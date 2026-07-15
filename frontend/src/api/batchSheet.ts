import { api } from "./client";
import type { BatchSheetOut } from "@/types/batchSheet";

export const batchSheetApi = {
  /** GET /api/batch-sheet?run_date=&instrument_serial=&instrument_serial=... - omit
   * instrumentSerials to include every instrument with a scheduled run that day. */
  get: (runDate: string, instrumentSerials?: string[]) => {
    const usp = new URLSearchParams({ run_date: runDate });
    (instrumentSerials ?? []).forEach((serial) => usp.append("instrument_serial", serial));
    return api.get<BatchSheetOut>(`/api/batch-sheet?${usp.toString()}`);
  },
};
